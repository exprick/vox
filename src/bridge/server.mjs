import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticateRequest, publicAuthConfig, HttpError } from './auth.mjs';
import {
  createRealtimeSession,
  normalizeSubtitleTargetLanguage,
  realtimeSessionConfig,
  transcribeWavBuffer,
  translateSubtitleText,
} from './voice.mjs';
import { listRecordings, saveRecording } from './recordings.mjs';
import { dispatchArtifactCreate } from './dispatch.mjs';
import { createFillBlankArtifact } from './fill-blank-template.mjs';
import {
  callTool,
  recordAppState,
  appStateSnapshot,
  codexTaskTable,
  bindToolCmdEnqueuer,
} from './tools/index.mjs';

const PORT = Number(process.env.PORT || 3203);
// Default to loopback: the bridge has unauthenticated local-dev routes that
// can enqueue commands and run tools. Use HOST=0.0.0.0 only on a trusted LAN.
const HOST = process.env.HOST || '127.0.0.1';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const WEB_DIR = path.join(PROJECT_ROOT, 'web');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures');
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);
const MAX_RECORDING_BYTES = Number(process.env.VOX_MAX_RECORDING_BYTES || process.env.MAX_RECORDING_BYTES || 50 * 1024 * 1024);
let webRealpathCache = null;
const MAX_CMD_QUEUE = Number(process.env.MAX_CMD_QUEUE || 200);
const MAX_CMD_RESULTS = Number(process.env.MAX_CMD_RESULTS || 200);
const CMD_RESULT_TTL_MS = Number(process.env.CMD_RESULT_TTL_MS || 10 * 60 * 1000);
const SUBTITLE_TRANSLATION_MAX_CHARS = Number(process.env.VOX_SUBTITLE_TRANSLATION_MAX_CHARS || 1200);
const SUBTITLE_TRANSLATION_RATE_LIMIT = Number(process.env.VOX_SUBTITLE_TRANSLATION_RATE_LIMIT || 60);
const SUBTITLE_TRANSLATION_WINDOW_MS = Number(process.env.VOX_SUBTITLE_TRANSLATION_WINDOW_MS || 60_000);
const SUBTITLE_TRANSLATION_CACHE_MAX = Number(process.env.VOX_SUBTITLE_TRANSLATION_CACHE_MAX || 500);
const SUBTITLE_TRANSLATION_CACHE_TTL_MS = Number(process.env.VOX_SUBTITLE_TRANSLATION_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const SUBTITLE_TRANSLATION_CLIENTS_MAX = Number(process.env.VOX_SUBTITLE_TRANSLATION_CLIENTS_MAX || 1000);
const SUBTITLE_TRANSLATION_SWEEP_INTERVAL_MS = Number(process.env.VOX_SUBTITLE_TRANSLATION_SWEEP_INTERVAL_MS || 60_000);
const subtitleTranslationCache = new Map();
const subtitleTranslationHits = new Map();
let lastSubtitleTranslationSweepMs = 0;

// in-memory test state ring buffer for iOS RealtimeClient → bridge IPC during E2E
const stateHistory = [];
const MAX_HISTORY = 200;

// iPhone polls /cmd/next; Mac POSTs to /cmd/push. Each cmd has unique id; iPhone POSTs result to /cmd/result.
const cmdQueue = [];          // pending commands waiting for iPhone to dequeue
const cmdResults = new Map(); // id → { result, completed_at }
let cmdCounter = 0;

// Helper for tool handlers (codex.mjs / system-prompt.mjs) to push cmds into
// the iPhone PollClient queue — used for async push-back-to-model and live
// session.update without going through the explicit /cmd/push HTTP endpoint.
function enqueueCmd(payload) {
  return pushCommand(payload);
}
bindToolCmdEnqueuer(enqueueCmd);

// iPhone uploads screenshots / logs / audio
let lastScreenshot = null;    // { bytes, ts }
let logBuffer = [];           // strings from iPhone
const MAX_LOG = 500;
let lastReceivedAudio = null; // { bytes, sampleRate, ts }

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const route = `${req.method} ${req.url.split('?')[0]}`;
  const fromIP = req.socket.remoteAddress?.replace('::ffff:', '') || '?';
  console.log(`${new Date().toISOString().slice(11,19)} ${fromIP.padEnd(15)} ${route}`);

  try {
    if (route === 'GET /health') {
      respond(res, 200, { ok: true });
      return;
    }
    if (route === 'GET /api/config') {
      const realtime = publicRealtimeConfig();
      respond(res, 200, {
        ok: true,
        auth: publicAuthConfig(),
        realtime,
        recordings: {
          enabled: true,
          max_bytes: MAX_RECORDING_BYTES,
        },
      });
      return;
    }
    if (route === 'GET /api/me') {
      const user = await authenticateRequest(req);
      respond(res, 200, { ok: true, user: publicUser(user) });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/fixtures/')) {
      await authenticateOrLocalBridge(req);
      const name = req.url.replace(/^\/fixtures\//, '').split('?')[0];
      if (!/^[\w.-]+$/.test(name)) { respond(res, 400, { error: 'bad name' }); return; }
      const file = path.join(FIXTURES_DIR, name);
      try {
        const data = await fs.readFile(file);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': data.length,
        });
        res.end(data);
      } catch (e) {
        respond(res, 404, { error: `fixture not found: ${name}` });
      }
      return;
    }
    if (route === 'POST /voice/session') {
      const user = await authenticateOrLocalBridge(req);
      const body = await readBody(req).catch(() => ({}));
      const session = await createRealtimeSession({
        user,
        clientResponseCreate: body?.client_response_create === true,
        manualInputTurns: body?.manual_input_turns === true,
      });
      respond(res, 200, { ...session, user: publicUser(user) });
      return;
    }
    if (route === 'POST /api/recordings') {
      const user = await authenticateRequest(req);
      const bytes = await readRawBody(req, MAX_RECORDING_BYTES);
      if (bytes.length === 0) { respond(res, 400, { ok: false, error: 'empty recording' }); return; }
      const metadata = await saveRecording({
        bytes,
        mimeType: req.headers['content-type'] || 'application/octet-stream',
        user,
        sessionId: headerValue(req, 'x-vox-session-id'),
        startedAt: headerValue(req, 'x-vox-started-at'),
        endedAt: headerValue(req, 'x-vox-ended-at'),
        durationMs: headerValue(req, 'x-vox-duration-ms'),
        transcript: parseJsonHeader(req, 'x-vox-transcript'),
        events: parseJsonHeader(req, 'x-vox-events'),
      });
      respond(res, 200, { ok: true, recording: metadata });
      return;
    }
    if (route === 'GET /api/recordings') {
      const user = await authenticateRequest(req);
      const recordings = await listRecordings({ user });
      respond(res, 200, { ok: true, recordings });
      return;
    }
    if (route === 'POST /api/translate') {
      const user = await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) { respond(res, 400, { ok: false, error: 'text is required' }); return; }
      if (text.length > SUBTITLE_TRANSLATION_MAX_CHARS) {
        respond(res, 400, { ok: false, error: 'text too long' });
        return;
      }
      let targetLanguage;
      try {
        targetLanguage = normalizeSubtitleTargetLanguage(body.target_language || 'Simplified Chinese');
      } catch {
        respond(res, 400, { ok: false, error: 'unsupported target_language' });
        return;
      }
      const clientKey = translationClientKey(user, req);
      const cacheKey = subtitleTranslationCacheKey(text, targetLanguage, clientKey);
      const cached = subtitleTranslationCache.get(cacheKey);
      // TTL is based on creation time so a bad translation cannot live forever just because it is popular.
      if (cached && Date.now() - cached.ts <= SUBTITLE_TRANSLATION_CACHE_TTL_MS) {
        subtitleTranslationCache.delete(cacheKey);
        subtitleTranslationCache.set(cacheKey, cached);
        respond(res, 200, { ok: true, ...cached.result, cached: true, cached_at: new Date(cached.ts).toISOString() });
        return;
      }
      if (cached) subtitleTranslationCache.delete(cacheKey);
      if (!allowSubtitleTranslation(clientKey)) {
        respond(res, 429, { ok: false, error: 'translation_rate_limited' });
        return;
      }
      try {
        const result = await translateSubtitleText(text, { targetLanguage });
        rememberSubtitleTranslation(cacheKey, result);
        respond(res, 200, { ok: true, ...result });
      } catch (error) {
        console.warn(`[vox] subtitle translation failed: ${error?.message || error}`);
        respond(res, 502, { ok: false, error: 'translation_failed' });
      }
      return;
    }
    if (route === 'POST /artifact/create') {
      await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      const result = await dispatchArtifactCreate(body);
      respond(res, result.ok ? 200 : 500, result);
      return;
    }
    // ── Agent tools (function_call dispatch from iPhone Realtime) ──
    if (route === 'POST /tool/call') {
      await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      const { name, arguments: argsField, args } = body;
      // OpenAI Realtime sends "arguments" as a JSON string on function_call;
      // accept either pre-parsed (args) or raw string (arguments).
      let parsedArgs = args;
      if (parsedArgs == null) {
        if (typeof argsField === 'string') {
          try { parsedArgs = argsField ? JSON.parse(argsField) : {}; }
          catch (e) { respond(res, 400, { error: `bad args JSON: ${e.message}` }); return; }
        } else {
          parsedArgs = argsField || {};
        }
      }
      try {
        const result = await callTool(name, parsedArgs);
        respond(res, 200, result);
      } catch (e) {
        respond(res, 200, { output: `tool error: ${e.message}` });
      }
      return;
    }
    if (route === 'POST /test/app-state') {
      await authenticateOrLocalBridge(req);
      // iPhone POSTs here on tab change / drill state change / transcript turn.
      const body = await readBody(req);
      respond(res, 200, recordAppState(body));
      return;
    }
    if (route === 'GET /test/app-state') {
      await authenticateOrLocalBridge(req);
      respond(res, 200, appStateSnapshot());
      return;
    }
    if (route === 'GET /test/codex-tasks') {
      await authenticateOrLocalBridge(req);
      respond(res, 200, { tasks: codexTaskTable() });
      return;
    }

    if (route === 'POST /artifact/fill-blank') {
      await authenticateOrLocalBridge(req);
      // Templated path — fast (<100ms), deterministic, used by Tab 2 Generate
      // button (iOS) AND by E2E tests + voice tools.
      // Body: { topic: string, questions: [{sentence, answer, options}, ...] }
      // Returns: { ok, artifact_id }
      const body = await readBody(req);
      try {
        const result = await createFillBlankArtifact(body);
        // Auto-mirror into app-state so get_app_state knows the active drill
        // even if iOS hasn't yet posted (e.g. WKWebView loaded an existing
        // artifact via generateIfEmpty without re-POSTing).
        recordAppState({
          drill: {
            kind: 'fill_blank',
            topic: body.topic,
            questions: body.questions,
            answered: 0,
            correct: 0,
            wrong: 0,
            completed: false,
          },
        });
        // Push a Tab 2 reload so the WKWebView picks up the new artifact even
        // when called via E2E / external HTTP (the iOS Generate button bumps
        // reloadToken locally; this covers everyone else). Parity with the
        // generate_drill tool which already enqueues this cmd.
        enqueueCmd({ action: 'reload_drill', args: {} });
        respond(res, 200, { ok: true, ...result });
      } catch (e) {
        respond(res, 400, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    // Static artifact serving — replaces the loopback-only python server.
    // Bridge already listens on 0.0.0.0 so this is reachable from iPhone over LAN.
    // Routes: /artifact/latest/  /artifact/latest/index.html  /artifact/<id>/<file>
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url.startsWith('/artifact/')) {
      await authenticateOrLocalBridge(req);
      const rel = req.url.replace(/^\/artifact\//, '').split('?')[0];
      // Disallow ../ traversal.
      if (rel.includes('..')) { respond(res, 400, { error: 'bad path' }); return; }
      // Default file: index.html when path ends with /
      let parts = rel.split('/');
      if (parts.length === 0 || parts[0] === '') { respond(res, 404, { error: 'no artifact id' }); return; }
      const id = parts[0]; // 'latest' or actual id
      const file = parts.slice(1).join('/') || 'index.html';
      const fullPath = path.join(PROJECT_ROOT, 'artifacts', id, file);
      try {
        const data = await fs.readFile(fullPath);
        const ct = file.endsWith('.html') ? 'text/html; charset=utf-8'
                 : file.endsWith('.css') ? 'text/css'
                 : file.endsWith('.js') ? 'application/javascript'
                 : file.endsWith('.json') ? 'application/json'
                 : file.endsWith('.png') ? 'image/png'
                 : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
        res.end(data);
      } catch (e) {
        respond(res, 404, { error: `artifact not found: ${rel}` });
      }
      return;
    }
    if (route === 'POST /test/state') {
      await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      const entry = { ...body, received_at: Date.now() };
      stateHistory.push(entry);
      if (stateHistory.length > MAX_HISTORY) stateHistory.shift();
      respond(res, 200, { ok: true });
      return;
    }
    if (route === 'GET /test/state') {
      await authenticateOrLocalBridge(req);
      respond(res, 200, { latest: stateHistory[stateHistory.length - 1] || null, count: stateHistory.length });
      return;
    }
    if (route === 'GET /test/state/history') {
      await authenticateOrLocalBridge(req);
      respond(res, 200, { history: stateHistory });
      return;
    }
    if (route === 'POST /test/state/clear') {
      await authenticateOrLocalBridge(req);
      stateHistory.length = 0;
      respond(res, 200, { ok: true });
      return;
    }

    // ── iPhone control: command queue ──
    if (route === 'POST /cmd/push') {
      await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      const id = pushCommand(body);
      respond(res, 200, { id });
      return;
    }
    if (route === 'GET /cmd/next') {
      await authenticateOrLocalBridge(req);
      const cmd = cmdQueue.shift() || null;
      respond(res, 200, { cmd });
      return;
    }
    if (route === 'POST /cmd/result') {
      await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      cmdResults.set(body.id, { result: body.result, error: body.error, completed_at: Date.now() });
      trimCommandResults();
      respond(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/cmd/result/')) {
      await authenticateOrLocalBridge(req);
      const id = req.url.replace('/cmd/result/', '').split('?')[0];
      const r = cmdResults.get(id);
      respond(res, r ? 200 : 404, r || { error: 'not found' });
      return;
    }

    // ── iPhone uploads ──
    if (route === 'POST /upload/screenshot') {
      await authenticateOrLocalBridge(req);
      lastScreenshot = { bytes: await readRawBody(req), ts: Date.now() };
      respond(res, 200, { ok: true, size: lastScreenshot.bytes.length });
      return;
    }
    if (route === 'GET /upload/screenshot') {
      await authenticateOrLocalBridge(req);
      if (!lastScreenshot) { respond(res, 404, { error: 'no screenshot' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': lastScreenshot.bytes.length });
      res.end(lastScreenshot.bytes);
      return;
    }
    if (route === 'POST /upload/log') {
      await authenticateOrLocalBridge(req);
      const body = await readBody(req);
      if (Array.isArray(body.lines)) logBuffer.push(...body.lines);
      if (logBuffer.length > MAX_LOG) logBuffer = logBuffer.slice(-MAX_LOG);
      respond(res, 200, { ok: true });
      return;
    }
    if (route === 'GET /upload/log') {
      await authenticateOrLocalBridge(req);
      respond(res, 200, { lines: logBuffer });
      return;
    }
    if (route === 'POST /upload/audio') {
      await authenticateOrLocalBridge(req);
      lastReceivedAudio = { bytes: await readRawBody(req), ts: Date.now() };
      respond(res, 200, { ok: true, size: lastReceivedAudio.bytes.length });
      return;
    }
    if (route === 'GET /upload/audio/transcribe') {
      await authenticateOrLocalBridge(req);
      if (!lastReceivedAudio) { respond(res, 404, { error: 'no audio' }); return; }
      const result = await transcribeWavBuffer(lastReceivedAudio.bytes);
      respond(res, 200, result);
      return;
    }
    if (route === 'GET /upload/audio.wav') {
      await authenticateOrLocalBridge(req);
      if (!lastReceivedAudio) { respond(res, 404, { error: 'no audio' }); return; }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': lastReceivedAudio.bytes.length });
      res.end(lastReceivedAudio.bytes);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const served = await serveStatic(req, res);
      if (served) return;
    }
    respond(res, 404, { error: `unknown route: ${route}` });
  } catch (e) {
    const status = e instanceof HttpError ? e.status
      : e.code === 'BODY_TOO_LARGE' ? 413
      : e.code === 'UNSUPPORTED_MEDIA_TYPE' ? 415
        : 500;
    respond(res, status, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`bridge HTTP listening on http://${HOST}:${PORT}`);
});

async function readBody(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const err = new Error('Content-Type must be application/json');
    err.code = 'UNSUPPORTED_MEDIA_TYPE';
    throw err;
  }
  const text = (await readRawBody(req)).toString('utf-8');
  return text ? JSON.parse(text) : {};
}

function pushCommand(payload) {
  const id = `c_${++cmdCounter}`;
  cmdQueue.push({ ...payload, id, created_at: Date.now() });
  while (cmdQueue.length > MAX_CMD_QUEUE) cmdQueue.shift();
  return id;
}

function trimCommandResults() {
  const cutoff = Date.now() - CMD_RESULT_TTL_MS;
  for (const [id, entry] of cmdResults) {
    if ((entry.completed_at || 0) < cutoff) cmdResults.delete(id);
  }
  while (cmdResults.size > MAX_CMD_RESULTS) {
    const oldest = cmdResults.keys().next().value;
    if (!oldest) break;
    cmdResults.delete(oldest);
  }
}

async function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > maxBytes) {
      const err = new Error(`request body too large: ${total} bytes > ${maxBytes}`);
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function respond(res, status, payload) {
  res.writeHead(status);
  res.end(JSON.stringify(payload));
}

function publicRealtimeConfig() {
  const { session, model, voice } = realtimeSessionConfig({
    instructions: ' ',
    clientResponseCreate: true,
    warn: () => {},
  });
  return {
    model,
    voice,
    output_modalities: session.output_modalities,
    reasoning_effort: session.reasoning?.effort,
    transcription_model: session.audio.input.transcription?.model,
    noise_reduction: session.audio.input.noise_reduction,
    turn_detection: session.audio.input.turn_detection,
  };
}

function subtitleTranslationCacheKey(text, targetLanguage, clientKey) {
  // Keep subtitle cache entries per authenticated caller. Anonymous local/dev
  // traffic falls back to a network bucket, but authenticated users do not share
  // `cached` and `cached_at` same-phrase timing with other users.
  // `rememberSubtitleTranslation` still enforces the shared LRU cap.
  return crypto
    .createHash('sha256')
    .update(`${clientKey}\0${targetLanguage}\0${text}`)
    .digest('hex');
}

function rememberSubtitleTranslation(key, result) {
  subtitleTranslationCache.set(key, { result, ts: Date.now() });
  while (subtitleTranslationCache.size > SUBTITLE_TRANSLATION_CACHE_MAX) {
    const oldest = subtitleTranslationCache.keys().next().value;
    if (!oldest) break;
    subtitleTranslationCache.delete(oldest);
  }
}

function translationClientKey(user, req) {
  return user?.safetyIdentifier || user?.id || normalizeNetworkAddress(req.socket.remoteAddress || 'unknown');
}

function allowSubtitleTranslation(key) {
  const now = Date.now();
  if (now - lastSubtitleTranslationSweepMs >= SUBTITLE_TRANSLATION_SWEEP_INTERVAL_MS) {
    sweepSubtitleTranslationHits(now);
    lastSubtitleTranslationSweepMs = now;
  }
  const existing = subtitleTranslationHits.get(key) || [];
  const recent = existing.filter((ts) => now - ts < SUBTITLE_TRANSLATION_WINDOW_MS);
  if (recent.length >= SUBTITLE_TRANSLATION_RATE_LIMIT) {
    subtitleTranslationHits.set(key, recent);
    return false;
  }
  recent.push(now);
  subtitleTranslationHits.delete(key);
  subtitleTranslationHits.set(key, recent);
  return true;
}

function sweepSubtitleTranslationHits(now = Date.now()) {
  for (const [key, hits] of subtitleTranslationHits) {
    const recent = hits.filter((ts) => now - ts < SUBTITLE_TRANSLATION_WINDOW_MS);
    if (recent.length) subtitleTranslationHits.set(key, recent);
    else subtitleTranslationHits.delete(key);
  }
  while (subtitleTranslationHits.size > SUBTITLE_TRANSLATION_CLIENTS_MAX) {
    const oldest = subtitleTranslationHits.keys().next().value;
    if (!oldest) break;
    subtitleTranslationHits.delete(oldest);
  }
}

async function serveStatic(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://vox.local');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    respond(res, 400, { error: 'bad url' });
    return true;
  }
  if (pathname === '/') {
    res.writeHead(307, {
      'Location': `/voice-course/${url.search}`,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }
  const rel = pathname.endsWith('/') ? `${pathname.slice(1)}index.html`
    : pathname.slice(1);
  const normalized = path.normalize(rel);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
    respond(res, 400, { error: 'bad path' });
    return true;
  }
  const filePath = path.join(WEB_DIR, normalized);
  try {
    const [webRootRealpath, fileRealpath] = await Promise.all([webRealpath(), fs.realpath(filePath)]);
    if (fileRealpath !== webRootRealpath && !fileRealpath.startsWith(`${webRootRealpath}${path.sep}`)) {
      respond(res, 400, { error: 'bad path' });
      return true;
    }
    if (req.method === 'HEAD') {
      const stats = await fs.stat(fileRealpath);
      if (stats.isDirectory()) {
        if (!pathname.endsWith('/')) {
          res.writeHead(308, {
            'Location': `${url.pathname}/${url.search}`,
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end();
          return true;
        }
        return false;
      }
      res.writeHead(200, {
        'Content-Type': contentTypeFor(fileRealpath),
        'Content-Length': stats.size,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }
    let data;
    try {
      data = await fs.readFile(fileRealpath);
    } catch (error) {
      if (error?.code === 'EISDIR') {
        if (!pathname.endsWith('/')) {
          res.writeHead(308, {
            'Location': `${url.pathname}/${url.search}`,
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end();
          return true;
        }
        return false;
      }
      throw error;
    }
    res.writeHead(200, {
      'Content-Type': contentTypeFor(fileRealpath),
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.webmanifest') return 'application/manifest+json; charset=utf-8';
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.woff2') return 'font/woff2';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function headerValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    provider: user.provider,
  };
}

async function webRealpath() {
  if (webRealpathCache) return webRealpathCache;
  webRealpathCache = await fs.realpath(WEB_DIR);
  return webRealpathCache;
}

async function authenticateOrLocalBridge(req) {
  try {
    return await authenticateRequest(req);
  } catch (error) {
    if (error instanceof HttpError && [401, 503].includes(error.status) && isTrustedLocalBridgeRequest(req)) {
      return {
        id: 'local-bridge',
        email: 'local@bridge.vox',
        name: 'Local Vox Bridge',
        provider: 'local-bridge',
        safetyIdentifier: 'local-bridge',
      };
    }
    throw error;
  }
}

function isTrustedLocalBridgeRequest(req) {
  if (String(process.env.VOX_ALLOW_LOCAL_BRIDGE_BYPASS || '0') !== '1') return false;
  const forwardedHeaders = [
    'cf-connecting-ip',
    'x-forwarded-for',
    'x-real-ip',
    'forwarded',
  ];
  if (forwardedHeaders.some((name) => req.headers[name])) return false;

  const remote = normalizeNetworkAddress(req.socket.remoteAddress || '');
  if (!isLoopbackAddress(remote)) return false;

  const host = hostNameFromHeader(req.headers.host);
  if (!isLoopbackAddress(host)) return false;

  return isTrustedLocalBrowserSource(req);
}

function normalizeNetworkAddress(value) {
  return String(value).trim().toLowerCase().replace(/^::ffff:/, '');
}

function hostNameFromHeader(value) {
  const host = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(1, end) : host;
  }
  return host.split(':')[0];
}

function isLoopbackAddress(value) {
  const normalized = normalizeNetworkAddress(value);
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function isTrustedLocalBrowserSource(req) {
  const origin = headerValue(req, 'origin');
  const referer = headerValue(req, 'referer');
  if (origin && !isLoopbackOrigin(origin)) return false;
  if (referer && !isLoopbackOrigin(referer)) return false;
  return true;
}

function isLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return isLoopbackAddress(url.hostname) && port === String(PORT);
  } catch {
    return false;
  }
}

function parseJsonHeader(req, name) {
  const value = headerValue(req, name);
  if (!value) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
