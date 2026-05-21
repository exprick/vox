import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const DEFAULT_RECORDINGS_DIR = path.join(PROJECT_ROOT, '.vox-recordings');
const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;

export function recordingsDir() {
  const configured = process.env.VOX_RECORDINGS_DIR || DEFAULT_RECORDINGS_DIR;
  return path.isAbsolute(configured) ? configured : path.join(PROJECT_ROOT, configured);
}

export async function saveRecording({ bytes, mimeType, user, sessionId, startedAt, endedAt, durationMs, transcript, events }) {
  await fs.mkdir(recordingsDir(), { recursive: true });
  const payloadBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  const hasAudioBytes = payloadBytes.length > 0;
  const safeMimeType = normalizeMimeType(mimeType);
  const now = new Date();
  const safeSessionId = sanitizeId(sessionId || `session-${Date.now()}`);
  const recordingId = `${userFilePrefix(user)}${now.toISOString().replace(/[:.]/g, '-')}-${safeSessionId}-${crypto.randomBytes(8).toString('hex')}`;
  const extension = extensionForMime(safeMimeType);
  const audioFile = hasAudioBytes ? `${recordingId}.${extension}` : null;
  const metadataFile = `${recordingId}.json`;
  const transcriptFile = `${recordingId}.transcript.json`;
  const transcriptTextFile = `${recordingId}.transcript.txt`;
  const captionsFile = `${recordingId}.vtt`;
  const subtitlesFile = `${recordingId}.srt`;
  const eventsFile = `${recordingId}.events.json`;
  const audioPath = audioFile ? path.join(recordingsDir(), audioFile) : null;
  const metadataPath = path.join(recordingsDir(), metadataFile);
  const transcriptPath = path.join(recordingsDir(), transcriptFile);
  const transcriptTextPath = path.join(recordingsDir(), transcriptTextFile);
  const captionsPath = path.join(recordingsDir(), captionsFile);
  const subtitlesPath = path.join(recordingsDir(), subtitlesFile);
  const eventsPath = path.join(recordingsDir(), eventsFile);
  const parsedDurationMs = durationMs == null || durationMs === '' ? NaN : Number(durationMs);
  const submittedTranscript = normalizeTranscript(transcript);
  const submittedEvents = normalizeEvents(events);
  const normalizedTranscript = submittedTranscript.slice(-500);
  const normalizedEvents = submittedEvents.slice(-500);
  const metadata = {
    id: recordingId,
    session_id: safeSessionId,
    user: {
      id: user.id,
      email: user.email,
      provider: user.provider,
    },
    recording_kind: hasAudioBytes ? 'audio' : 'transcript',
    mime_type: safeMimeType,
    bytes: payloadBytes.length,
    audio_file: audioFile,
    transcript_file: transcriptFile,
    transcript_text_file: transcriptTextFile,
    captions_file: captionsFile,
    subtitles_file: subtitlesFile,
    events_file: eventsFile,
    started_at: startedAt || null,
    ended_at: endedAt || now.toISOString(),
    duration_ms: Number.isFinite(parsedDurationMs) ? parsedDurationMs : null,
    transcript: normalizedTranscript,
    transcript_count: normalizedTranscript.length,
    realtime_events_count: normalizedEvents.length,
    saved_at: now.toISOString(),
  };

  const createdPaths = [];
  if (audioPath) {
    await fs.writeFile(audioPath, payloadBytes, { flag: 'wx' });
    createdPaths.push(audioPath);
  }
  try {
    const writes = [
      [transcriptPath, `${JSON.stringify(normalizedTranscript, null, 2)}\n`],
      [transcriptTextPath, transcriptText(normalizedTranscript)],
      [captionsPath, webVtt(normalizedTranscript, metadata.duration_ms)],
      [subtitlesPath, srt(normalizedTranscript, metadata.duration_ms)],
      [eventsPath, `${JSON.stringify(normalizedEvents, null, 2)}\n`],
      [metadataPath, `${JSON.stringify(metadata, null, 2)}\n`],
    ];
    for (const [file, contents] of writes) {
      try {
        await fs.writeFile(file, contents, { flag: 'wx' });
        createdPaths.push(file);
      } catch (writeError) {
        if (writeError.code !== 'EEXIST') await fs.unlink(file).catch(() => {});
        throw writeError;
      }
    }
  } catch (error) {
    await Promise.all(createdPaths.map((file) => fs.unlink(file).catch(() => {})));
    throw error;
  }
  return metadata;
}

export async function listRecordings({ limit = 50, user } = {}) {
  try {
    const files = await fs.readdir(recordingsDir());
    const prefix = userFilePrefix(user);
    let jsonFiles = files.filter((name) => name.endsWith('.json') && !/\.(transcript|events)\.json$/.test(name));
    if (prefix) jsonFiles = jsonFiles.filter((name) => name.startsWith(prefix));
    jsonFiles = jsonFiles.sort().reverse();
    const entries = [];
    for (const file of jsonFiles) {
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(recordingsDir(), file), 'utf8'));
        if (user?.id && metadata.user?.id !== user.id) continue;
        entries.push(metadata);
        if (entries.length >= limit) break;
      } catch {
        // Ignore partial or corrupt runtime files; they should not break listing.
      }
    }
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .filter((turn) => turn && typeof turn.role === 'string' && typeof turn.text === 'string' && turn.text.trim())
    .map((turn) => ({
      id: typeof turn.id === 'string' ? turn.id.slice(0, 64) : undefined,
      role: turn.role.slice(0, 32),
      text: turn.text.slice(0, 2000),
      zh: typeof turn.zh === 'string' ? turn.zh.slice(0, 2000) : undefined,
      ts: typeof turn.ts === 'number' && Number.isFinite(turn.ts) ? turn.ts : null,
    }));
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event && typeof event.type === 'string' && event.type.trim())
    .map((event) => ({
      type: event.type.trim().slice(0, 96),
      ts: typeof event.ts === 'number' && Number.isFinite(event.ts) ? event.ts : null,
      role: typeof event.role === 'string' ? event.role.slice(0, 32) : undefined,
      text: typeof event.text === 'string' ? event.text.slice(0, 1000) : undefined,
      message: typeof event.message === 'string' ? event.message.slice(0, 1000) : undefined,
    }));
}

function transcriptText(transcript) {
  const lines = transcript.map((turn) => {
    const zh = turn.zh ? `\n[${turn.role}.zh] ${turn.zh}` : '';
    return `[${turn.role}] ${turn.text}${zh}`;
  });
  return `${lines.join('\n')}${lines.length ? '\n' : ''}`;
}

function webVtt(transcript, durationMs) {
  const cues = captionCues(transcript, durationMs);
  return `WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}\n`).join('\n')}`;
}

function srt(transcript, durationMs) {
  const body = captionCues(transcript, durationMs)
    .map((cue, index) => `${index + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}\n`)
    .join('\n');
  return body ? `${body}\n` : '';
}

function captionCues(transcript, durationMs) {
  const turns = transcript.filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && turn.text);
  if (!turns.length) return [];
  const firstTs = turns.find((turn) => Number.isFinite(turn.ts))?.ts;
  const hasFirstTs = Number.isFinite(firstTs);
  const fallbackTotalMs = Math.max(turns.length * 2500, 2500);
  const suppliedTotalMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : fallbackTotalMs;
  const transcriptSpanMs = hasFirstTs
    ? Math.max(...turns.map((turn) => (Number.isFinite(turn.ts) ? turn.ts - firstTs : 0)), 0)
    : 0;
  const totalMs = Math.max(suppliedTotalMs, transcriptSpanMs + 500);
  let previousEnd = 0;
  return turns.map((turn, index) => {
    const next = turns[index + 1];
    let start = hasFirstTs && Number.isFinite(turn.ts) ? Math.max(0, turn.ts - firstTs) : Math.floor((index * totalMs) / turns.length);
    let end = hasFirstTs && next && Number.isFinite(next.ts) ? Math.max(start + 500, next.ts - firstTs) : Math.floor(((index + 1) * totalMs) / turns.length);
    start = Math.max(start, previousEnd);
    end = Math.max(end, start + 500);
    previousEnd = end;
    const subtitle = turn.zh ? ` / ${turn.zh}` : '';
    return { start, end, text: captionText(`${turn.role}: ${turn.text}${subtitle}`) };
  });
}

function captionText(value) {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/-\s*-\s*>/g, '->')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatVttTime(ms) {
  return formatCaptionTime(ms, '.');
}

function formatSrtTime(ms) {
  return formatCaptionTime(ms, ',');
}

function formatCaptionTime(ms, separator) {
  const clamped = Math.max(0, Math.floor(ms));
  const hours = Math.floor(clamped / 3600000);
  const minutes = Math.floor((clamped % 3600000) / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${String(millis).padStart(3, '0')}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function sanitizeId(value) {
  const candidate = String(value || '').slice(0, 80);
  return SAFE_ID_RE.test(candidate) ? candidate : crypto.createHash('sha256').update(candidate).digest('hex').slice(0, 24);
}

function userFilePrefix(user) {
  const stableId = user?.id || user?.email || '';
  if (!stableId) return '';
  const digest = crypto.createHash('sha256').update(`vox-recording-user:${stableId}`).digest('hex').slice(0, 24);
  return `u-${digest}-`;
}

function extensionForMime(mimeType = '') {
  const type = mimeType.toLowerCase().split(';')[0].trim();
  if (type === 'audio/webm') return 'webm';
  if (type === 'audio/mp4') return 'mp4';
  if (type === 'audio/mpeg') return 'mp3';
  if (type === 'audio/wav' || type === 'audio/wave' || type === 'audio/x-wav') return 'wav';
  if (type === 'audio/ogg') return 'ogg';
  return 'bin';
}

function normalizeMimeType(mimeType = '') {
  const type = String(mimeType).toLowerCase().split(';')[0].trim();
  if (['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg'].includes(type)) {
    return type;
  }
  return 'application/octet-stream';
}
