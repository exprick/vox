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
  const body = {
    model: opts.model || 'gpt-realtime',
    voice: opts.voice || 'alloy',
    modalities: ['audio', 'text'],
    instructions,
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: { model: 'whisper-1' },
    tools: TOOL_DEFINITIONS,
    tool_choice: 'auto',
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: true,
      interrupt_response: true,
    },
  };
  const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`realtime session create failed: ${resp.status} ${text}`);
  }
  return resp.json();
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
