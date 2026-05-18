import fs from 'node:fs/promises';
import path from 'node:path';
import { TOOL_DEFINITIONS } from './tools/index.mjs';
import { readSystemPromptFromFile } from './tools/system-prompt.mjs';

const VOX_INSTRUCTIONS = `You are Vox, a language learning agent for a Chinese-speaking English learner at A2-B2 level.

Goal: help the learner practice English for travel (ordering food, asking directions, hotel check-in) and social situations (small talk with native speakers, introducing themselves online or in person).

Language policy:
- Default to clear, friendly, natural-pace English.
- The learner may switch to Chinese to clarify a word, ask for translation, or sort out an idea. Briefly answer in Chinese, then guide them back to English practice.
- Don't lecture. Conversational English, short replies, real back-and-forth.
- For small grammar slips, recast naturally ("Oh, so you went yesterday?") rather than explicitly correcting.
- For repeated fossilized errors (e.g. "interested about" → "interested in"), once across the same session: a brief explicit note, then move on.

Personality: warm, patient, encouraging. Never judgmental.

Keep responses short and natural — this is a real conversation, not a lesson.`;

export async function createRealtimeSession(opts = {}) {
  const apiKey = await readOpenAIKey();
  // Prefer per-deployment override (data/system_prompt.txt) → that's what
  // the Realtime model will read. Falls back to the default literal.
  const overridden = await readSystemPromptFromFile();
  const baseInstructions = opts.instructions || overridden || VOX_INSTRUCTIONS;
  // Always append the tool-usage hint so the model knows it has function
  // calls available — without this nudge it tends to ignore them.
  const TOOL_HINT = `\n\n--- AVAILABLE TOOLS ---
You have function calls for:
- get_app_state — see what tab/drill the user is looking at + recent transcript
- list_memory / read_memory — read your own per-project memory files
- write_memory — save a new memory file (always voice-confirm with the user first)
- update_system_prompt — rewrite your own instructions (persists + applies live)
- generate_drill — make a fill-in-the-blank multiple-choice quiz and put it on Tab 2 (auto-switches user to that tab); pass {topic, questions?} — provide questions explicitly when you have good practice items from context, otherwise just topic and a starter pack is used
- dispatch_codex — spawn a coding worker on Mac, async — you'll get a follow-up system message when done
- get_codex_tasks — see status of recent Codex tasks (use to answer "is it done yet")

USE THESE PROACTIVELY. If the user asks "what tab am I on", call get_app_state. If they ask what you remember, call list_memory. If they want a drill / practice / quiz, call generate_drill. If they want a code change, call dispatch_codex (acknowledge by voice while it runs). If they ask "is codex done", call get_codex_tasks. Do not say "I cannot see" or "I don't have access" — there is almost always a tool for it.`;
  const instructions = baseInstructions + TOOL_HINT;
  const model = process.env.VOX_REALTIME_MODEL || 'gpt-realtime';
  const voice = process.env.VOX_REALTIME_VOICE || 'marin';
  const transcriptionModel = process.env.VOX_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
  const transcription = { model: transcriptionModel };
  const transcriptionLanguage = process.env.VOX_TRANSCRIPTION_LANGUAGE?.trim();
  if (transcriptionLanguage) transcription.language = transcriptionLanguage;
  const session = {
    type: 'realtime',
    model,
    instructions,
    audio: {
      input: {
        transcription,
        turn_detection: realtimeTurnDetectionConfig(),
      },
      output: {
        voice,
      },
    },
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
  };
  const resp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(opts.user?.safetyIdentifier ? { 'OpenAI-Safety-Identifier': opts.user.safetyIdentifier } : {}),
    },
    body: JSON.stringify({ session }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`realtime client secret create failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  const value = data.value || data.client_secret?.value;
  return {
    ...data,
    client_secret: {
      ...(data.client_secret || {}),
      value,
    },
    model,
    voice,
  };
}

export function realtimeTurnDetectionConfig(env = process.env, opts = {}) {
  const warn = typeof opts.warn === 'function' ? opts.warn : console.warn;
  return {
    type: 'server_vad',
    threshold: readNumberEnv(env.VOX_VAD_THRESHOLD, 0.65, { min: 0, max: 1, name: 'VOX_VAD_THRESHOLD', warn }),
    prefix_padding_ms: readIntegerEnv(env.VOX_VAD_PREFIX_PADDING_MS, 500, { min: 0, max: 2000, name: 'VOX_VAD_PREFIX_PADDING_MS', warn }),
    silence_duration_ms: readIntegerEnv(env.VOX_VAD_SILENCE_DURATION_MS, 900, { min: 200, max: 3000, name: 'VOX_VAD_SILENCE_DURATION_MS', warn }),
    create_response: readBooleanEnv(env.VOX_VAD_CREATE_RESPONSE, true, { name: 'VOX_VAD_CREATE_RESPONSE', warn }),
    interrupt_response: readBooleanEnv(env.VOX_VAD_INTERRUPT_RESPONSE, false, { name: 'VOX_VAD_INTERRUPT_RESPONSE', warn }),
  };
}

export async function transcribeWavBuffer(wavBytes, model = 'whisper-1') {
  const apiKey = await readOpenAIKey();
  const blob = new Blob([wavBytes], { type: 'audio/wav' });
  const fd = new FormData();
  fd.append('file', blob, 'audio.wav');
  fd.append('model', model);
  fd.append('response_format', 'verbose_json');
  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!resp.ok) throw new Error(`whisper failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function readOpenAIKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  throw new Error('OPENAI_API_KEY not found');
}

function readNumberEnv(value, fallback, { min, max, name, warn, integer = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized == null || normalized === '') return fallback;
  const parsed = Number(normalized);
  const reject = (reason) => {
    warnInvalidEnv({ name, value, reason, fallback, warn });
    return fallback;
  };
  if (!Number.isFinite(parsed)) return reject('not a number');
  if (integer && !Number.isInteger(parsed)) return reject('expected an integer');
  if (min != null && parsed < min) return reject(`below ${min}`);
  if (max != null && parsed > max) return reject(`above ${max}`);
  return parsed;
}

function readIntegerEnv(value, fallback, bounds = {}) {
  return readNumberEnv(value, fallback, { ...bounds, integer: true });
}

function readBooleanEnv(value, fallback, { name, warn } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (normalized == null || normalized === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(String(normalized))) return true;
  if (/^(0|false|no|off)$/i.test(String(normalized))) return false;
  warnInvalidEnv({ name, value, reason: 'expected a boolean', fallback, warn });
  return fallback;
}

function warnInvalidEnv({ name, value, reason, fallback, warn }) {
  if (!name || typeof warn !== 'function') return;
  warn(`[vox] Ignoring ${name}=${JSON.stringify(String(value))}: ${reason}; using ${fallback}`);
}
