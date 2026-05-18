import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { authenticateRequest, authConfig, publicAuthConfig } from '../src/bridge/auth.mjs';
import { listRecordings, saveRecording } from '../src/bridge/recordings.mjs';
import { realtimeTurnDetectionConfig } from '../src/bridge/voice.mjs';

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

test('realtime turn detection defaults avoid self-interrupting short fragments', () => {
  const cfg = realtimeTurnDetectionConfig({}, { warn: () => {} });
  assert.equal(cfg.type, 'server_vad');
  assert.equal(cfg.threshold, 0.65);
  assert.equal(cfg.prefix_padding_ms, 500);
  assert.equal(cfg.silence_duration_ms, 900);
  assert.equal(cfg.create_response, true);
  assert.equal(cfg.interrupt_response, false);
});

test('realtime turn detection env overrides are bounded and explicit', () => {
  assert.deepEqual(realtimeTurnDetectionConfig({
    VOX_VAD_THRESHOLD: '0.72',
    VOX_VAD_PREFIX_PADDING_MS: '650',
    VOX_VAD_SILENCE_DURATION_MS: '1200',
    VOX_VAD_CREATE_RESPONSE: 'false',
    VOX_VAD_INTERRUPT_RESPONSE: ' true ',
  }, { warn: () => {} }), {
    type: 'server_vad',
    threshold: 0.72,
    prefix_padding_ms: 650,
    silence_duration_ms: 1200,
    create_response: false,
    interrupt_response: true,
  });

  const warnings = [];
  const fallback = realtimeTurnDetectionConfig({
    VOX_VAD_THRESHOLD: '1.5',
    VOX_VAD_PREFIX_PADDING_MS: '500.9',
    VOX_VAD_SILENCE_DURATION_MS: '50',
    VOX_VAD_INTERRUPT_RESPONSE: 'maybe',
  }, { warn: (message) => warnings.push(message) });
  assert.equal(fallback.threshold, 0.65);
  assert.equal(fallback.prefix_padding_ms, 500);
  assert.equal(fallback.silence_duration_ms, 900);
  assert.equal(fallback.interrupt_response, false);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_THRESHOLD')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_PREFIX_PADDING_MS')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_SILENCE_DURATION_MS')));
  assert.ok(warnings.some((message) => message.includes('VOX_VAD_INTERRUPT_RESPONSE')));

  const blankFallback = realtimeTurnDetectionConfig({
    VOX_VAD_THRESHOLD: '',
    VOX_VAD_PREFIX_PADDING_MS: ' ',
  }, { warn: (message) => warnings.push(message) });
  assert.equal(blankFallback.threshold, 0.65);
  assert.equal(blankFallback.prefix_padding_ms, 500);
});

test('web voice course waits for learner speech before starting a realtime response', async () => {
  const html = await fs.readFile(new URL('../web/voice-course/index.html', import.meta.url), 'utf8');
  const onOpenStart = html.indexOf('state.dc.onopen');
  const nextHandlerStart = html.indexOf('state.dc.onmessage', onOpenStart);
  assert.notEqual(onOpenStart, -1, 'data channel open handler should exist');
  assert.notEqual(nextHandlerStart, -1, 'data channel message handler should follow open handler');
  const onOpenHandler = html.slice(onOpenStart, nextHandlerStart);
  assert.equal(onOpenHandler.includes('response.create'), false);
  assert.equal(html.includes('Start the session with one short friendly greeting'), false);
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
