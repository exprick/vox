import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRealtimeSession, transcribeWavBuffer } from './voice.mjs';
import { dispatchArtifactCreate } from './dispatch.mjs';
import { createFillBlankArtifact } from './fill-blank-template.mjs';
import {
  callTool,
  recordAppState,
  appStateSnapshot,
  codexTaskTable,
  bindToolCmdEnqueuer,
} from './tools/index.mjs';

const PORT = Number(process.env.PORT || 3205);
// Default to loopback: the bridge has unauthenticated local-dev routes that
// can enqueue commands and run tools. Use HOST=0.0.0.0 only on a trusted LAN.
const HOST = process.env.HOST || '127.0.0.1';
const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures');
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);
const MAX_CMD_QUEUE = Number(process.env.MAX_CMD_QUEUE || 200);
const MAX_CMD_RESULTS = Number(process.env.MAX_CMD_RESULTS || 200);
const CMD_RESULT_TTL_MS = Number(process.env.CMD_RESULT_TTL_MS || 10 * 60 * 1000);

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
    if (req.method === 'GET' && req.url.startsWith('/fixtures/')) {
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
      const body = await readBody(req);
      const session = await createRealtimeSession(body);
      respond(res, 200, session);
      return;
    }
    if (route === 'POST /artifact/create') {
      const body = await readBody(req);
      const result = await dispatchArtifactCreate(body);
      respond(res, result.ok ? 200 : 500, result);
      return;
    }
    // ── Agent tools (function_call dispatch from iPhone Realtime) ──
    if (route === 'POST /tool/call') {
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
      // iPhone POSTs here on tab change / drill state change / transcript turn.
      const body = await readBody(req);
      respond(res, 200, recordAppState(body));
      return;
    }
    if (route === 'GET /test/app-state') {
      respond(res, 200, appStateSnapshot());
      return;
    }
    if (route === 'GET /test/codex-tasks') {
      respond(res, 200, { tasks: codexTaskTable() });
      return;
    }

    if (route === 'POST /artifact/fill-blank') {
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
      const body = await readBody(req);
      const entry = { ...body, received_at: Date.now() };
      stateHistory.push(entry);
      if (stateHistory.length > MAX_HISTORY) stateHistory.shift();
      respond(res, 200, { ok: true });
      return;
    }
    if (route === 'GET /test/state') {
      respond(res, 200, { latest: stateHistory[stateHistory.length - 1] || null, count: stateHistory.length });
      return;
    }
    if (route === 'GET /test/state/history') {
      respond(res, 200, { history: stateHistory });
      return;
    }
    if (route === 'POST /test/state/clear') {
      stateHistory.length = 0;
      respond(res, 200, { ok: true });
      return;
    }

    // ── iPhone control: command queue ──
    if (route === 'POST /cmd/push') {
      const body = await readBody(req);
      const id = pushCommand(body);
      respond(res, 200, { id });
      return;
    }
    if (route === 'GET /cmd/next') {
      const cmd = cmdQueue.shift() || null;
      respond(res, 200, { cmd });
      return;
    }
    if (route === 'POST /cmd/result') {
      const body = await readBody(req);
      cmdResults.set(body.id, { result: body.result, error: body.error, completed_at: Date.now() });
      trimCommandResults();
      respond(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/cmd/result/')) {
      const id = req.url.replace('/cmd/result/', '').split('?')[0];
      const r = cmdResults.get(id);
      respond(res, r ? 200 : 404, r || { error: 'not found' });
      return;
    }

    // ── iPhone uploads ──
    if (route === 'POST /upload/screenshot') {
      lastScreenshot = { bytes: await readRawBody(req), ts: Date.now() };
      respond(res, 200, { ok: true, size: lastScreenshot.bytes.length });
      return;
    }
    if (route === 'GET /upload/screenshot') {
      if (!lastScreenshot) { respond(res, 404, { error: 'no screenshot' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': lastScreenshot.bytes.length });
      res.end(lastScreenshot.bytes);
      return;
    }
    if (route === 'POST /upload/log') {
      const body = await readBody(req);
      if (Array.isArray(body.lines)) logBuffer.push(...body.lines);
      if (logBuffer.length > MAX_LOG) logBuffer = logBuffer.slice(-MAX_LOG);
      respond(res, 200, { ok: true });
      return;
    }
    if (route === 'GET /upload/log') {
      respond(res, 200, { lines: logBuffer });
      return;
    }
    if (route === 'POST /upload/audio') {
      lastReceivedAudio = { bytes: await readRawBody(req), ts: Date.now() };
      respond(res, 200, { ok: true, size: lastReceivedAudio.bytes.length });
      return;
    }
    if (route === 'GET /upload/audio/transcribe') {
      if (!lastReceivedAudio) { respond(res, 404, { error: 'no audio' }); return; }
      const result = await transcribeWavBuffer(lastReceivedAudio.bytes);
      respond(res, 200, result);
      return;
    }
    if (route === 'GET /upload/audio.wav') {
      if (!lastReceivedAudio) { respond(res, 404, { error: 'no audio' }); return; }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': lastReceivedAudio.bytes.length });
      res.end(lastReceivedAudio.bytes);
      return;
    }
    respond(res, 404, { error: `unknown route: ${route}` });
  } catch (e) {
    const status = e.code === 'BODY_TOO_LARGE' ? 413
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

async function readRawBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error(`request body too large: ${total} bytes > ${MAX_BODY_BYTES}`);
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
