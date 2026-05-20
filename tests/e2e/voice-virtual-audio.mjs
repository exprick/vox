#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FIXTURES } from '../../src/bridge/fixtures.mjs';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
await loadLocalEnv(PROJECT_ROOT);

const DEFAULT_FIXTURE = 'greet-en';
const DEFAULT_LOOPBACK_DEVICE = 'BlackHole 2ch';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_FAKE_FILE_LEAD_MS = 6_000;

const opts = parseArgs(process.argv.slice(2));
const mode = opts.mode || process.env.VOX_E2E_AUDIO_MODE || 'loopback';
const fixtureId = opts.fixture || process.env.VOX_E2E_FIXTURE || DEFAULT_FIXTURE;
const timeoutMs = Number(opts.timeout || process.env.VOX_E2E_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
const fakeFileLeadMs = Number(opts.fakeFileLeadMs || process.env.VOX_E2E_FAKE_FILE_LEAD_MS || DEFAULT_FAKE_FILE_LEAD_MS);
const dryRun = Boolean(opts.dryRun);
const headed = Boolean(opts.headed || process.env.VOX_E2E_HEADED);
const loopbackDevice = opts.device || process.env.VOX_E2E_LOOPBACK_DEVICE || DEFAULT_LOOPBACK_DEVICE;
const skipAudioSwitch = Boolean(opts.skipAudioSwitch || process.env.VOX_E2E_SKIP_AUDIO_SWITCH);

if (!['loopback', 'fake-file'].includes(mode)) {
  fail(`unsupported --mode=${mode}; use loopback or fake-file`);
}

const runRoot = path.join(PROJECT_ROOT, '.harness', 'e2e', 'voice-virtual-audio', stamp());
const fixturesDir = path.join(runRoot, 'fixtures');
const recordingsDir = path.join(runRoot, 'recordings');
const screenshotsDir = path.join(runRoot, 'screenshots');

let serverProc;
let restoreAudio = async () => {};

try {
  await fs.mkdir(recordingsDir, { recursive: true });
  await fs.mkdir(screenshotsDir, { recursive: true });

  const fixture = await prepareFixture(fixtureId, fixturesDir);
  const playwright = await loadPlaywright();
  const audioPlan = await prepareAudioPlan({ mode, fixture, loopbackDevice, skipAudioSwitch, dryRun });

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      mode,
      fixture,
      audio: audioPlan,
      run_root: runRoot,
    }, null, 2));
    process.exit(0);
  }

  if (!process.env.OPENAI_API_KEY) {
    fail('OPENAI_API_KEY is required for live Realtime E2E');
  }

  const port = Number(opts.port || process.env.PORT || await freePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  serverProc = await startBridge({ port, recordingsDir });

  const result = await runBrowserE2E({
    playwright,
    baseUrl,
    fixture,
    mode,
    headed,
    timeoutMs,
    fakeFileLeadMs,
    screenshotsDir,
  });

  const summary = {
    ok: true,
    mode,
    base_url: baseUrl,
    fixture,
    audio: audioPlan,
    run_root: runRoot,
    screenshots_dir: screenshotsDir,
    recordings_dir: recordingsDir,
    ...result,
  };
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
  await restoreAudio();
}

async function prepareFixture(id, outDir) {
  const override = opts.fixtureWav || process.env.VOX_E2E_FIXTURE_WAV;
  if (override) {
    const wav = path.resolve(override);
    await assertAudioFile(wav, 'fixture wav');
    return { id, wav, pcm: null, source: 'override' };
  }

  const spec = FIXTURES.find((item) => item.id === id);
  if (!spec) fail(`unknown fixture: ${id}`);

  await fs.mkdir(outDir, { recursive: true });
  const tmpDir = path.join(outDir, `.tmp-${process.pid}-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const partFiles = [];
  for (let i = 0; i < spec.segments.length; i += 1) {
    const segment = spec.segments[i];
    const part = path.join(tmpDir, `part-${i}.aiff`);
    await cmdOk('/usr/bin/say', ['-v', segment.voice, '-o', part, segment.text]);
    await assertAudioFile(part, `say output for ${spec.id} segment ${i}`);
    partFiles.push(part);
  }

  const listFile = path.join(tmpDir, 'concat.txt');
  await fs.writeFile(listFile, partFiles.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));

  const wav = path.join(outDir, `${spec.id}.wav`);
  await cmdOk('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  await assertAudioFile(wav, 'fixture wav');
  await fs.rm(tmpDir, { recursive: true, force: true });

  return { id: spec.id, wav, source: 'generated' };
}

async function prepareAudioPlan({ mode: planMode, fixture, loopbackDevice: device, skipAudioSwitch: skipSwitch, dryRun: checkOnly }) {
  if (planMode === 'fake-file') {
    return {
      mode: 'fake-file',
      input: fixture.wav,
      note: 'Chromium receives the fixture via --use-file-for-fake-audio-capture.',
    };
  }

  const switchAudioSource = await which('SwitchAudioSource');
  if (!switchAudioSource) {
    fail('SwitchAudioSource is required for --mode=loopback. Install switchaudio-osx, or run --mode=fake-file.');
  }

  const inputDevices = await cmdText(switchAudioSource, ['-a', '-t', 'input']).catch(() => '');
  const outputDevices = await cmdText(switchAudioSource, ['-a', '-t', 'output']).catch(() => '');
  const deviceKnown = inputDevices.includes(device) || outputDevices.includes(device);
  if (!deviceKnown && !skipSwitch) {
    fail(`loopback device "${device}" was not found. Set VOX_E2E_LOOPBACK_DEVICE or pass --skip-audio-switch if it is already selected.`);
  }

  const previousInput = await cmdText(switchAudioSource, ['-c', '-t', 'input']).catch(() => '');
  const previousOutput = await cmdText(switchAudioSource, ['-c', '-t', 'output']).catch(() => '');

  if (!checkOnly && !skipSwitch) {
    const restorePreviousAudio = async () => {
      if (previousInput.trim()) await cmdOk(switchAudioSource, ['-s', previousInput.trim(), '-t', 'input']).catch(() => {});
      if (previousOutput.trim()) await cmdOk(switchAudioSource, ['-s', previousOutput.trim(), '-t', 'output']).catch(() => {});
    };
    restoreAudio = restorePreviousAudio;
    try {
      await cmdOk(switchAudioSource, ['-s', device, '-t', 'input']);
      await cmdOk(switchAudioSource, ['-s', device, '-t', 'output']);
    } catch (error) {
      await restorePreviousAudio();
      throw error;
    }
  }

  return {
    mode: 'loopback',
    device,
    switched_system_audio: !skipSwitch && !checkOnly,
    previous_input: previousInput.trim() || null,
    previous_output: previousOutput.trim() || null,
    note: 'afplay sends the fixture to the macOS output device; Chromium captures the same virtual device as microphone input.',
  };
}

async function runBrowserE2E({ playwright, baseUrl, fixture, mode: runMode, headed: showBrowser, timeoutMs: timeout, fakeFileLeadMs: leadMs, screenshotsDir: shotsDir }) {
  const browserFixture = runMode === 'fake-file'
    ? await addLeadSilence(fixture, leadMs)
    : fixture;
  const browserArgs = [
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];
  if (runMode === 'fake-file') {
    browserArgs.push('--use-fake-device-for-media-stream');
    browserArgs.push(`--use-file-for-fake-audio-capture=${browserFixture.wav}`);
  }

  const browser = await playwright.chromium.launch({
    headless: !showBrowser,
    args: browserArgs,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 430, height: 860 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await context.grantPermissions(['microphone'], { origin: baseUrl });

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    await page.addInitScript(() => {
      window.__voxE2ESnapshot = () => {
        const turns = [...document.querySelectorAll('.turn')].map((turn) => ({
          id: turn.getAttribute('data-turn-id') || '',
          role: turn.classList.contains('user') ? 'user'
            : turn.classList.contains('assistant') ? 'assistant'
              : 'system',
          text: turn.querySelector('.text')?.textContent?.trim() || '',
          zh: turn.querySelector('.zh-subtitle')?.textContent?.trim() || '',
          zh_status: turn.querySelector('.zh-subtitle')?.getAttribute('data-subtitle-status') || '',
          zh_pending: turn.querySelector('.zh-subtitle')?.classList.contains('pending') || false,
        })).filter((turn) => turn.text);
        const userText = turns.filter((turn) => turn.role === 'user').map((turn) => turn.text).join('\n');
        const assistantText = turns.filter((turn) => turn.role === 'assistant').map((turn) => turn.text).join('\n');
        return {
          turns,
          user_text: userText,
          assistant_text: assistantText,
          connection: document.querySelector('#connectionBadge')?.textContent || '',
          transport: document.querySelector('#transportState')?.textContent || '',
          recording_state: document.querySelector('#recordingState')?.textContent || '',
        };
      };
    });
    await page.goto(`${baseUrl}/voice-course/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#callButton:not([disabled])');
    await page.screenshot({ path: path.join(shotsDir, 'ready.png'), fullPage: false });

    await page.click('#callButton');
    await page.waitForFunction(() => {
      const transport = document.querySelector('#transportState')?.textContent || '';
      const badge = document.querySelector('#connectionBadge')?.textContent || '';
      return /Listening|ICE connected|ICE completed/i.test(transport) || /Live|Listening/i.test(badge);
    });

    await page.waitForFunction(() => /Send/i.test(document.querySelector('#callButton')?.textContent || ''));
    if (runMode === 'loopback') {
      await cmdOk('/usr/bin/afplay', [fixture.wav]);
    } else {
      await page.waitForTimeout(Math.max(2500, leadMs + 3500));
    }
    await page.click('#callButton');

    const conversation = await waitForConversation(page, timeout, shotsDir, fixture.id);
    const semantic = validateConversationSemantics(conversation, fixture.id);

    await page.screenshot({ path: path.join(shotsDir, 'conversation.png'), fullPage: false });

    await page.click('#endCallButton');
    await page.waitForFunction(() => /Saved|No browser audio was captured|Recording pending|Recording save failed/i.test(
      document.querySelector('#recordingState')?.textContent || ''
    ));

    const recordingState = await page.locator('#recordingState').textContent();
    const recordings = await fetchJson(`${baseUrl}/api/recordings`);
    if (!recordings.ok || !Array.isArray(recordings.recordings)) {
      fail(`recordings response was not valid: ${JSON.stringify(recordings).slice(0, 400)}`);
    }
    if (!recordings.recordings.length) {
      fail(`no recording was saved; recording state: ${recordingState}`);
    }

    return {
      conversation,
      semantic,
      recording_state: recordingState,
      recording_count: recordings.recordings.length,
      latest_recording: compactRecording(recordings.recordings[0]),
    };
  } finally {
    await browser.close();
  }
}

async function waitForConversation(page, timeout, shotsDir, fixtureId) {
  try {
    return await page.waitForFunction(() => {
      const snapshot = window.__voxE2ESnapshot?.() || null;
      if (!snapshot) return null;
      if (!/practice|ordering|restaurant|food/i.test(snapshot.user_text)) return null;
      if (!/order|restaurant|food|点|餐厅|吃/i.test(snapshot.assistant_text)) return null;
      const assistantTurns = snapshot.turns.filter((turn) => turn.role === 'assistant');
      if (!assistantTurns.length || assistantTurns.some((turn) => turn.zh_pending || !/[\u3400-\u9fff]/.test(turn.zh || ''))) return null;
      if (assistantTurns.some((turn) => turn.zh_status !== 'ready')) return null;
      return snapshot;
    }, { timeout }).then((handle) => handle.jsonValue());
  } catch (error) {
    await page.screenshot({ path: path.join(shotsDir, 'timeout.png'), fullPage: false }).catch(() => {});
    const snapshot = await page.evaluate(() => window.__voxE2ESnapshot?.() || {}).catch(() => ({}));
    await fs.writeFile(path.join(shotsDir, 'timeout-state.json'), `${JSON.stringify(snapshot, null, 2)}\n`).catch(() => {});
    throw new Error(`timed out waiting for user+assistant turns and Chinese subtitles for ${fixtureId}: ${JSON.stringify(snapshot).slice(0, 800)}`, { cause: error });
  }
}

function validateConversationSemantics(snapshot, fixtureId) {
  const issues = [];
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  const userTurns = turns.filter((turn) => turn.role === 'user');
  const assistantTurns = turns.filter((turn) => turn.role === 'assistant');
  if (!userTurns.length) issues.push('missing user turn');
  if (!assistantTurns.length) issues.push('missing Vox turn');
  if (turns.some((turn) => turn.role === 'user' && turn.zh)) issues.push('Chinese subtitle is attached to a user turn');
  if (assistantTurns.some((turn) => turn.zh_pending)) issues.push('Vox subtitle is still pending');
  if (assistantTurns.some((turn) => !turn.zh || !/[\u3400-\u9fff]/.test(turn.zh))) issues.push('Vox turn is missing Simplified Chinese subtitle');
  if (assistantTurns.some((turn) => /生成中/.test(turn.zh || ''))) issues.push('Vox subtitle placeholder was accepted as final subtitle');
  if (assistantTurns.some((turn) => turn.zh_status !== 'ready')) issues.push('Vox subtitle did not come from the live translation path');
  if (assistantTurns.some((turn) => normalizeForSemantic(turn.text) === normalizeForSemantic(turn.zh))) issues.push('Vox subtitle duplicates the English text');

  const userText = normalizeForSemantic(snapshot.user_text);
  const assistantText = normalizeForSemantic(snapshot.assistant_text);
  if (fixtureId === 'greet-en') {
    for (const token of ['practice', 'ordering', 'food', 'restaurant']) {
      if (!userText.includes(token)) issues.push(`user transcript lost semantic token: ${token}`);
    }
    if (!/(order|restaurant|food|点|餐厅|吃)/.test(assistantText)) {
      issues.push('Vox reply is not semantically tied to the ordering-food conversation');
    }
  }
  if (userText && assistantText && userText === assistantText) {
    issues.push('user and Vox transcript are identical');
  }
  if (assistantText && !/[A-Za-z]/.test(snapshot.assistant_text || '')) {
    issues.push('Vox reply should include at least one useful English phrase');
  }

  const result = {
    ok: issues.length === 0,
    fixture: fixtureId,
    checks: {
      user_turns: userTurns.length,
      assistant_turns: assistantTurns.length,
      assistant_subtitles: assistantTurns.filter((turn) => turn.zh).length,
      role_order: turns.map((turn) => turn.role),
    },
    issues,
  };
  if (!result.ok) {
    throw new Error(`semantic transcript check failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function normalizeForSemantic(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function addLeadSilence(fixture, leadMs) {
  if (!leadMs || leadMs <= 0) return fixture;
  const delayed = path.join(path.dirname(fixture.wav), `${fixture.id}.fake-file-input.wav`);
  const seconds = String(Math.max(0, leadMs / 1000));
  await cmdOk('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-t', seconds,
    '-i', 'anullsrc=r=24000:cl=mono',
    '-i', fixture.wav,
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1',
    '-ar', '24000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    delayed,
  ]);
  await assertAudioFile(delayed, 'fake-file fixture with lead silence');
  return { ...fixture, wav: delayed, source: `${fixture.source}+lead-silence-${leadMs}ms` };
}

async function startBridge({ port, recordingsDir: dir }) {
  const proc = spawn(process.execPath, ['src/bridge/server.mjs'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      VOX_AUTH_REQUIRED: '0',
      VOX_RECORDINGS_DIR: dir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => process.stderr.write(`[bridge] ${chunk}`));
  proc.stderr.on('data', (chunk) => process.stderr.write(`[bridge] ${chunk}`));
  proc.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      process.stderr.write(`[bridge] exited code=${code} signal=${signal}\n`);
    }
  });
  await waitForHealth(`http://127.0.0.1:${port}/health`, 10_000);
  return proc;
}

async function waitForHealth(url, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const payload = await fetchJson(url);
      if (payload.ok) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`bridge did not become healthy: ${lastError?.message || 'timeout'}`);
}

async function fetchJson(url) {
  const resp = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} returned non-JSON ${resp.status}: ${text.slice(0, 300)}`);
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {}

  const cli = await which('playwright');
  if (cli) {
    const realCli = await fs.realpath(cli);
    const moduleRoot = path.dirname(realCli);
    try {
      return await import(pathToFileURL(path.join(moduleRoot, 'index.mjs')).href);
    } catch {}
  }

  const bundledCandidates = [
    process.env.VOX_E2E_PLAYWRIGHT_MODULE,
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright', 'index.mjs'),
  ].filter(Boolean);
  for (const bundled of bundledCandidates) {
    try {
      await fs.access(bundled);
      return await import(pathToFileURL(bundled).href);
    } catch {}
  }

  fail('Playwright is required. Install the playwright package, make the playwright CLI available on PATH, or set VOX_E2E_PLAYWRIGHT_MODULE to playwright/index.mjs.');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function assertFile(file, label) {
  try {
    await fs.access(file);
  } catch {
    fail(`${label} does not exist: ${file}`);
  }
}

async function assertAudioFile(file, label) {
  await assertFile(file, label);
  const stat = await fs.stat(file);
  if (stat.size < 10_000) {
    fail(`${label} is too small to contain usable speech (${stat.size} bytes): ${file}`);
  }
}

async function which(name) {
  const paths = String(process.env.PATH || '').split(path.delimiter);
  for (const dir of paths) {
    const candidate = path.join(dir, name);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function cmdText(cmd, args) {
  return run(cmd, args).then(({ stdout }) => stdout.trim());
}

function cmdOk(cmd, args) {
  return run(cmd, args).then(({ code, stdout, stderr }) => {
    if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${stderr || stdout}`);
    return stdout;
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function stopProcess(proc) {
  if (proc.exitCode != null || proc.signalCode) return;
  proc.kill('SIGTERM');
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (proc.exitCode != null || proc.signalCode) return;
    await sleep(50);
  }
  proc.kill('SIGKILL');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactRecording(item) {
  return {
    saved_at: item.saved_at,
    bytes: item.bytes,
    mime_type: item.mime_type,
    transcript_count: Array.isArray(item.transcript) ? item.transcript.length : 0,
    realtime_events_count: Array.isArray(item.events) ? item.events.length : item.realtime_events_count,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--headed') parsed.headed = true;
    else if (arg === '--force-fixtures') parsed.forceFixtures = true;
    else if (arg === '--skip-audio-switch') parsed.skipAudioSwitch = true;
    else if (arg.startsWith('--mode=')) parsed.mode = arg.slice('--mode='.length);
    else if (arg === '--mode') parsed.mode = argv[++i];
    else if (arg.startsWith('--fixture=')) parsed.fixture = arg.slice('--fixture='.length);
    else if (arg === '--fixture') parsed.fixture = argv[++i];
    else if (arg.startsWith('--fixture-wav=')) parsed.fixtureWav = arg.slice('--fixture-wav='.length);
    else if (arg === '--fixture-wav') parsed.fixtureWav = argv[++i];
    else if (arg.startsWith('--device=')) parsed.device = arg.slice('--device='.length);
    else if (arg === '--device') parsed.device = argv[++i];
    else if (arg.startsWith('--timeout=')) parsed.timeout = arg.slice('--timeout='.length);
    else if (arg === '--timeout') parsed.timeout = argv[++i];
    else if (arg.startsWith('--fake-file-lead-ms=')) parsed.fakeFileLeadMs = arg.slice('--fake-file-lead-ms='.length);
    else if (arg === '--fake-file-lead-ms') parsed.fakeFileLeadMs = argv[++i];
    else if (arg.startsWith('--port=')) parsed.port = arg.slice('--port='.length);
    else if (arg === '--port') parsed.port = argv[++i];
    else fail(`unknown argument: ${arg}`);
  }
  return parsed;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function loadLocalEnv(projectRoot) {
  const envFile = path.join(projectRoot, '.env');
  let raw;
  try {
    raw = await fs.readFile(envFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function fail(message) {
  throw new Error(message);
}
