#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURES } from '../../src/bridge/fixtures.mjs';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
await loadLocalEnv(PROJECT_ROOT);

const opts = parseArgs(process.argv.slice(2));
const fixtureId = opts.fixture || process.env.VOX_E2E_FIXTURE || 'greet-en';
const timeoutMs = Number(opts.timeout || process.env.VOX_E2E_TIMEOUT_MS || 120_000);
const voice = Boolean(opts.voice || process.env.VOX_E2E_IOS_VOICE);
const startBridge = Boolean(opts.startBridge);
const port = Number(opts.port || process.env.PORT || 3203);
const baseUrl = opts.baseUrl || `http://127.0.0.1:${port}`;
const runRoot = path.join(PROJECT_ROOT, '.harness', 'e2e', 'ios-native-voice', stamp());

let serverProc;

try {
  await fs.mkdir(runRoot, { recursive: true });
  if (startBridge) {
    serverProc = await startBridgeServer({ port, runRoot });
  } else {
    await waitForHealth(`${baseUrl}/health`, 10_000);
  }

  await postJson(`${baseUrl}/test/state/clear`, {});
  const ping = await command('ping');
  if (!ping?.result?.pong) fail(`ping failed: ${JSON.stringify(ping)}`);

  const initialState = await command('state');
  const screenshots = [];
  const shot = await command('screenshot').catch((error) => ({ error: error.message }));
  if (shot?.result?.uploaded) {
    const png = await fetchBytes(`${baseUrl}/upload/screenshot`);
    const file = path.join(runRoot, 'initial.png');
    await fs.writeFile(file, png);
    screenshots.push(file);
  }

  const summary = {
    ok: true,
    mode: voice ? 'voice' : 'smoke',
    base_url: baseUrl,
    run_root: runRoot,
    initial_state: initialState?.result || null,
    screenshots,
  };

  if (voice) {
    const fixture = await prepareFixture(fixtureId);
    const voiceResult = await runVoiceTurn({ fixture });
    Object.assign(summary, voiceResult);
  }

  await fs.writeFile(path.join(runRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  try {
    await fs.mkdir(runRoot, { recursive: true });
    await fs.writeFile(path.join(runRoot, 'error.txt'), `${error?.stack || error}\n`);
  } catch {}
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (serverProc) await stopProcess(serverProc);
}

async function runVoiceTurn({ fixture }) {
  if (!process.env.OPENAI_API_KEY) fail('OPENAI_API_KEY is required for live iOS voice E2E');

  const connect = await command('connect');
  if (!['connected', 'connecting'].includes(connect?.result?.state)) {
    fail(`connect command failed: ${JSON.stringify(connect)}`);
  }

  await waitForState((state) => state.state === 'connected' && state.dataChannelOpen === true, 'connected data channel', timeoutMs);
  const ready = await command('state');
  if (ready?.result?.manualInputTurns !== false) {
    fail(`iOS session did not use continuous listening turns: ${JSON.stringify(ready)}`);
  }
  if (ready?.result?.isMicrophoneOpen !== true) {
    fail(`iOS microphone should open after Start in continuous mode: ${JSON.stringify(ready)}`);
  }
  const readyTurnCount = Number(ready?.result?.transcriptTurnCount || 0);
  const previousUserText = String(ready?.result?.lastUserUtterance || '').trim();
  const previousAssistantText = String(ready?.result?.lastAssistantText || '').trim();

  await cmdOk('/usr/bin/afplay', [fixture.wav]);

  const userState = await waitForState((state) => {
    const text = String(state.lastUserUtterance || '').trim();
    return Number(state.transcriptTurnCount || 0) > readyTurnCount &&
      text.length > 0 &&
      text !== previousUserText;
  }, 'new user transcript', timeoutMs);
  const assistantState = await waitForState((state) => {
    const text = String(state.lastAssistantText || '').trim();
    return Number(state.transcriptTurnCount || 0) > readyTurnCount &&
      text.length > 0 &&
      text !== previousAssistantText &&
      findTurnIndex(state, 'assistant', text) >= 0;
  }, 'new assistant transcript', timeoutMs);
  const reopenedState = await waitForState(
    (state) => state.isAssistantSpeaking === false && state.assistantPlaybackCoolingDown === false && state.isMicrophoneOpen === true,
    'microphone reopened after assistant playback',
    timeoutMs
  );

  const paused = await command('pause_listening');
  if (paused?.result?.ok !== true || paused?.result?.paused !== true || paused?.result?.micOpen !== false) {
    fail(`pause_listening failed: ${JSON.stringify(paused)}`);
  }
  const resumed = await command('resume_listening');
  if (resumed?.result?.ok !== true || resumed?.result?.paused !== false || resumed?.result?.micOpen !== true) {
    fail(`resume_listening failed: ${JSON.stringify(resumed)}`);
  }

  const userText = normalizeSpeechText(userState.lastUserUtterance || '');
  const assistantText = normalizeSpeechText(assistantState.lastAssistantText || '');
  if (userText && assistantText && userText === assistantText) {
    fail(`assistant playback was captured as user input: ${JSON.stringify({ userText, assistantText })}`);
  }
  assertTranscriptOrder(assistantState, userState.lastUserUtterance || '', assistantState.lastAssistantText || '');

  const stateHistory = await fetchJson(`${baseUrl}/test/state/history`);
  await fs.writeFile(path.join(runRoot, 'state-history.json'), `${JSON.stringify(stateHistory, null, 2)}\n`);
  await command('disconnect').catch(() => null);

  return {
    fixture,
    user_transcript: userState.lastUserUtterance || '',
    assistant_transcript: assistantState.lastAssistantText || '',
    final_state: reopenedState || null,
    state_history_path: path.join(runRoot, 'state-history.json'),
  };
}

async function prepareFixture(id) {
  const spec = FIXTURES.find((item) => item.id === id);
  if (!spec) fail(`unknown fixture: ${id}`);
  const fixturesDir = path.join(runRoot, 'fixtures');
  await fs.mkdir(fixturesDir, { recursive: true });
  const tmpDir = path.join(fixturesDir, `.tmp-${process.pid}-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const parts = [];
  for (let i = 0; i < spec.segments.length; i += 1) {
    const segment = spec.segments[i];
    const part = path.join(tmpDir, `part-${i}.aiff`);
    await cmdOk('/usr/bin/say', ['-v', segment.voice, '-o', part, segment.text]);
    parts.push(part);
  }
  const listFile = path.join(tmpDir, 'concat.txt');
  await fs.writeFile(listFile, parts.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
  const wav = path.join(fixturesDir, `${spec.id}.wav`);
  await cmdOk('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  await fs.rm(tmpDir, { recursive: true, force: true });
  return {
    id,
    wav,
    expect: spec.expect,
    text: spec.segments.map((segment) => segment.text).join(' '),
  };
}

async function command(action, args = {}) {
  const pushed = await postJson(`${baseUrl}/cmd/push`, { action, args });
  const id = pushed.id;
  if (!id) fail(`command push missing id for ${action}: ${JSON.stringify(pushed)}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(`${baseUrl}/cmd/result/${id}`);
    if (resp.status === 200) {
      const payload = await resp.json();
      if (payload.error) throw new Error(`${action} failed: ${payload.error}`);
      return payload;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for command ${action} (${id})`);
}

async function waitForState(predicate, label, timeout) {
  const deadline = Date.now() + timeout;
  let latest = null;
  while (Date.now() < deadline) {
    const state = await command('state').then((payload) => payload.result || {});
    latest = state;
    if (predicate(state)) return state;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(latest)}`);
}

async function startBridgeServer({ port: bridgePort, runRoot: root }) {
  const env = {
    ...process.env,
    PORT: String(bridgePort),
    HOST: '0.0.0.0',
    VOX_AUTH_REQUIRED: '0',
    VOX_RECORDINGS_DIR: path.join(root, 'recordings'),
  };
  const proc = spawn(process.execPath, ['src/bridge/server.mjs'], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logFile = await fs.open(path.join(root, 'bridge.log'), 'a');
  proc.stdout.on('data', (data) => logFile.write(data).catch(() => {}));
  proc.stderr.on('data', (data) => logFile.write(data).catch(() => {}));
  proc.on('exit', () => logFile.close().catch(() => {}));
  proc.on('error', () => logFile.close().catch(() => {}));
  await waitForHealth(`http://127.0.0.1:${bridgePort}/health`, 15_000);
  return proc;
}

async function waitForHealth(url, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`bridge health not ready: ${url}`);
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${url} HTTP ${resp.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function fetchJson(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${url} HTTP ${resp.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function fetchBytes(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url} HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

function cmdOk(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exit ${code}: ${stderr.trim().slice(0, 400)}`));
    });
  });
}

function stopProcess(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode != null || proc.signalCode != null) { resolve(); return; }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 3000);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try { proc.kill('SIGTERM'); } catch { resolve(); }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSpeechText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function findTurnIndex(state, role, text) {
  const wanted = normalizeSpeechText(text);
  const turns = Array.isArray(state?.transcriptTurns) ? state.transcriptTurns : [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]?.role !== role) continue;
    if (normalizeSpeechText(turns[i]?.text) === wanted) return i;
  }
  return -1;
}

function assertTranscriptOrder(state, userText, assistantText) {
  const turns = Array.isArray(state?.transcriptTurns) ? state.transcriptTurns : [];
  const userIndex = findTurnIndex(state, 'user', userText);
  const assistantIndex = findTurnIndex(state, 'assistant', assistantText);
  if (userIndex < 0 || assistantIndex < 0) {
    fail(`missing transcript turns for order check: ${JSON.stringify({ userText, assistantText, turns })}`);
  }
  if (userIndex > assistantIndex) {
    fail(`subtitle order is not user-before-assistant: ${JSON.stringify({ userIndex, assistantIndex, turns })}`);
  }
  const userTs = Number(turns[userIndex]?.ts || 0);
  const assistantTs = Number(turns[assistantIndex]?.ts || 0);
  if (userTs && assistantTs && userTs > assistantTs) {
    fail(`subtitle timestamps are not speaking-order aligned: ${JSON.stringify({ userTs, assistantTs, turns })}`);
  }
}

async function loadLocalEnv(projectRoot) {
  const envFile = path.join(projectRoot, '.env');
  let text = '';
  try { text = await fs.readFile(envFile, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(trimmed.slice(idx + 1).trim());
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--voice') parsed.voice = true;
    else if (arg === '--start-bridge') parsed.startBridge = true;
    else if (arg === '--fixture') parsed.fixture = args[++i];
    else if (arg === '--timeout') parsed.timeout = args[++i];
    else if (arg === '--port') parsed.port = args[++i];
    else if (arg === '--base-url') parsed.baseUrl = args[++i];
    else if (arg.startsWith('--')) fail(`unknown arg: ${arg}`);
  }
  return parsed;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

function fail(message) {
  throw new Error(message);
}
