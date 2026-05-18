import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { authenticateRequest, authConfig, publicAuthConfig } from '../src/bridge/auth.mjs';
import { listRecordings, saveRecording } from '../src/bridge/recordings.mjs';

test('auth can be explicitly disabled for local development', async (t) => {
  t.after(withEnv({
    VOX_AUTH_REQUIRED: '0',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    VOX_ALLOWED_EMAILS: '',
    VOX_ALLOWED_DOMAINS: '',
  }));
  const user = await authenticateRequest({ headers: {} });
  assert.equal(user.email, 'dev@local.vox');
  assert.equal(user.provider, 'dev');
  assert.equal(user.safetyIdentifier.length, 64);
});

test('public auth config exposes only browser-safe fields', (t) => {
  t.after(withEnv({
    VOX_AUTH_REQUIRED: '1',
    SUPABASE_URL: 'https://example.supabase.co/',
    SUPABASE_ANON_KEY: 'anon-public-key',
    VOX_ALLOWED_EMAILS: 'rick@exp.game',
    VOX_ALLOWED_DOMAINS: '',
  }));
  const cfg = publicAuthConfig();
  assert.equal(cfg.required, true);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.supabaseUrl, 'https://example.supabase.co');
  assert.equal(cfg.supabaseAnonKey, 'anon-public-key');
  assert.equal(cfg.allowlistConfigured, true);
  assert.deepEqual(Object.keys(cfg).sort(), [
    'allowlistConfigured',
    'configured',
    'provider',
    'required',
    'supabaseAnonKey',
    'supabaseUrl',
  ]);
  assert.equal(Object.hasOwn(cfg, 'allowedEmails'), false);
  assert.equal(Object.hasOwn(cfg, 'allowedDomains'), false);
  assert.deepEqual(authConfig().allowedEmails, ['rick@exp.game']);
});

test('recordings save audio and metadata without returning raw bytes in list output', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));
  const user = { id: 'u_123', email: 'rick@exp.game', provider: 'test' };
  const result = await saveRecording({
    bytes: Buffer.from('audio bytes'),
    mimeType: 'audio/webm',
    user,
    sessionId: 'session:one',
    startedAt: '2026-05-18T00:00:00.000Z',
    endedAt: '2026-05-18T00:00:01.000Z',
    durationMs: 1000,
    transcript: [{ role: 'user', text: 'hello' }],
  });
  assert.equal(result.bytes, 11);
  assert.match(result.audio_file, /\.webm$/);

  const files = await fs.readdir(dir);
  assert.equal(files.filter((file) => file.endsWith('.webm')).length, 1);
  assert.equal(files.filter((file) => file.endsWith('.json')).length, 1);

  const list = await listRecordings({ user, limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].audio_file, result.audio_file);
  assert.equal(list[0].bytes, 11);
  assert.deepEqual(list[0].transcript, [{ role: 'user', text: 'hello' }]);
  assert.equal(Object.hasOwn(list[0], 'audio_bytes'), false);
});

test('recordings use the correct file extension for mp3 uploads', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-mpeg-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));
  const user = { id: 'u_mp3', email: 'rick@exp.game', provider: 'test' };
  const result = await saveRecording({
    bytes: Buffer.from('mp3 bytes'),
    mimeType: 'audio/mpeg',
    user,
    sessionId: 'session-mp3',
  });
  assert.match(result.audio_file, /\.mp3$/);
});

test('empty recording duration is stored as null', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-duration-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));
  const user = { id: 'u_duration', email: 'rick@exp.game', provider: 'test' };
  const result = await saveRecording({
    bytes: Buffer.from('audio bytes'),
    mimeType: 'audio/webm',
    user,
    durationMs: '',
  });
  assert.equal(result.duration_ms, null);
});

test('recording listing filters by user before applying limit', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vox-recordings-list-test-'));
  t.after(withEnv({ VOX_RECORDINGS_DIR: dir }));

  await writeRecordingMetadata(dir, `${recordingUserPrefix('user-a')}2026-05-18T00-00-00-000Z-user-a.json`, 'user-a');
  for (let index = 0; index < 160; index += 1) {
    await writeRecordingMetadata(
      dir,
      `${recordingUserPrefix('user-b')}2026-05-18T00-01-${String(index).padStart(3, '0')}-000Z-user-b.json`,
      'user-b'
    );
  }

  const list = await listRecordings({ user: { id: 'user-a' }, limit: 1 });
  assert.equal(list.length, 1);
  assert.equal(list[0].user.id, 'user-a');
});

function withEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function writeRecordingMetadata(dir, file, userId) {
  await fs.writeFile(path.join(dir, file), JSON.stringify({
    id: file.replace(/\.json$/, ''),
    session_id: file,
    user: { id: userId, email: `${userId}@example.com`, provider: 'test' },
    mime_type: 'audio/webm',
    bytes: 1,
    audio_file: file.replace(/\.json$/, '.webm'),
    saved_at: '2026-05-18T00:00:00.000Z',
  }));
}

function recordingUserPrefix(userId) {
  const digest = crypto.createHash('sha256').update(`vox-recording-user:${userId}`).digest('hex').slice(0, 24);
  return `u-${digest}-`;
}
