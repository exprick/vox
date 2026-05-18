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

export async function saveRecording({ bytes, mimeType, user, sessionId, startedAt, endedAt, durationMs, transcript }) {
  await fs.mkdir(recordingsDir(), { recursive: true });
  const safeMimeType = normalizeMimeType(mimeType);
  const now = new Date();
  const safeSessionId = sanitizeId(sessionId || `session-${Date.now()}`);
  const recordingId = `${userFilePrefix(user)}${now.toISOString().replace(/[:.]/g, '-')}-${safeSessionId}-${crypto.randomBytes(8).toString('hex')}`;
  const extension = extensionForMime(safeMimeType);
  const audioFile = `${recordingId}.${extension}`;
  const metadataFile = `${recordingId}.json`;
  const audioPath = path.join(recordingsDir(), audioFile);
  const metadataPath = path.join(recordingsDir(), metadataFile);
  const parsedDurationMs = durationMs == null || durationMs === '' ? NaN : Number(durationMs);
  const metadata = {
    id: recordingId,
    session_id: safeSessionId,
    user: {
      id: user.id,
      email: user.email,
      provider: user.provider,
    },
    mime_type: safeMimeType,
    bytes: bytes.length,
    audio_file: audioFile,
    started_at: startedAt || null,
    ended_at: endedAt || now.toISOString(),
    duration_ms: Number.isFinite(parsedDurationMs) ? parsedDurationMs : null,
    transcript: Array.isArray(transcript) ? transcript.slice(-200) : [],
    saved_at: now.toISOString(),
  };

  await fs.writeFile(audioPath, bytes, { flag: 'wx' });
  try {
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    await fs.unlink(audioPath).catch(() => {});
    throw error;
  }
  return metadata;
}

export async function listRecordings({ limit = 50, user } = {}) {
  try {
    const files = await fs.readdir(recordingsDir());
    const prefix = userFilePrefix(user);
    let jsonFiles = files.filter((name) => name.endsWith('.json'));
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
