// Async dispatch of codex exec. Returns {task_id, status:"running"} immediately
// so the Realtime model can ack the user with voice ("ok, give me a moment");
// when codex finishes, we enqueue a PollClient cmd that pushes a
// conversation.item.create back to the model so it proactively reports the
// result.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const MAX_PROMPT_CHARS = Number(process.env.VOX_MAX_CODEX_PROMPT_CHARS || 50_000);
const tasks = new Map(); // task_id → {status, started_at, ended_at, prompt, result, error, cwd}

let injectQueue = null;
export function bindCmdEnqueuer(fn) { injectQueue = fn; }

export function getTaskTable() {
  return Array.from(tasks.values()).slice(-20);
}

function summarizeOutput(out, errOut, exitCode) {
  // For voice playback, we want a short human-readable summary, not a wall
  // of stdout. Take last_message-style output if present, fall back to last
  // 400 chars of stdout.
  const txt = (out || '').trim();
  if (!txt) {
    if (errOut && errOut.trim()) return `codex stderr: ${errOut.trim().slice(-300)}`;
    return `codex exited ${exitCode} with no output`;
  }
  if (txt.length <= 600) return txt;
  return txt.slice(-600);
}

export function dispatchCodexTool({ prompt, working_dir }) {
  if (!prompt || typeof prompt !== 'string') {
    return { output: 'error: prompt argument required (string)' };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { output: `error: prompt too long (${prompt.length} chars > ${MAX_PROMPT_CHARS})` };
  }
  let cwd = PROJECT_ROOT;
  if (working_dir && typeof working_dir === 'string') {
    const resolved = path.resolve(
      path.isAbsolute(working_dir) ? working_dir : path.join(PROJECT_ROOT, working_dir),
    );
    // Codex runs with --full-auto so the cwd MUST stay inside the project root.
    // Otherwise a LAN-reachable /tool/call (or prompt injection from a
    // compromised conversation) could execute arbitrary commands in $HOME / /tmp.
    // Codex review P1.
    const rel = path.relative(PROJECT_ROOT, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return { output: `error: working_dir must be inside project root (${PROJECT_ROOT})` };
    }
    if (!existsSync(resolved)) {
      return { output: `error: working_dir does not exist: ${resolved}` };
    }
    cwd = resolved;
  }

  const task_id = `cx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const entry = {
    task_id, status: 'running', started_at: Date.now(), ended_at: null,
    prompt: prompt.slice(0, 200), cwd, result: null, error: null,
  };
  tasks.set(task_id, entry);

  // Spawn in background; do NOT await.
  const args = ['exec', '--full-auto', '--skip-git-repo-check', '-C', cwd, prompt];
  const proc = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  proc.on('error', (err) => {
    entry.status = 'error';
    entry.error = String(err.message || err);
    entry.ended_at = Date.now();
    pushBackToModel(entry, `codex spawn error: ${entry.error}`);
  });
  proc.on('exit', (code) => {
    entry.ended_at = Date.now();
    if (code === 0) {
      entry.status = 'done';
      entry.result = summarizeOutput(stdout, stderr, code);
    } else {
      entry.status = 'failed';
      entry.error = `exit ${code}`;
      entry.result = summarizeOutput(stdout, stderr, code);
    }
    pushBackToModel(entry, formatTaskMessage(entry));
  });

  return {
    output: JSON.stringify({
      task_id,
      status: 'running',
      started_at: entry.started_at,
      message: 'Codex started in the background. I will speak again when it finishes.',
    }),
  };
}

/// Additional task-source registration so future async-spawning tools can
/// surface their tasks through the same get_codex_tasks surface.
const externalSources = [];
export function registerCodexTaskSource(getter) {
  externalSources.push(getter);
}

/// Tool: list recent Codex tasks. Lets Vox answer "what's codex doing"
/// or "did the last task finish" by looking at the same table that backs
/// /test/codex-tasks. Returns most recent N (newest first).
export function getCodexTasksTool({ limit } = {}) {
  const n = Math.min(Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 5, 20);
  const ours = Array.from(tasks.values()).map((t) => ({ ...t, kind: 'dispatch_codex' }));
  let merged = ours.slice();
  for (const getter of externalSources) {
    try {
      const ext = getter() || [];
      for (const t of ext) merged.push({ ...t, kind: t.kind || 'external' });
    } catch {}
  }
  // Sort by started_at; newest first.
  merged.sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  const trimmed = merged.slice(0, n).map(t => ({
    task_id: t.task_id,
    kind: t.kind,
    status: t.status,
    elapsed_s: t.ended_at
      ? Math.round((t.ended_at - t.started_at) / 1000)
      : Math.round((Date.now() - t.started_at) / 1000),
    prompt: t.prompt,
    cwd: t.cwd,
    error: t.error || null,
    result_excerpt: t.result ? t.result.slice(0, 300) : null,
    artifact_id: t.artifact_id || null,
  }));
  return { output: JSON.stringify({ count: trimmed.length, tasks: trimmed }) };
}

function formatTaskMessage(entry) {
  const dur = Math.round((entry.ended_at - entry.started_at) / 1000);
  if (entry.status === 'done') {
    return `Codex task ${entry.task_id} finished in ${dur}s. Result:\n${entry.result}`;
  }
  return `Codex task ${entry.task_id} ${entry.status} in ${dur}s. ${entry.error ? `Error: ${entry.error}` : ''}\n${entry.result || ''}`;
}

function pushBackToModel(entry, text) {
  if (!injectQueue) return;
  // PollClient action: iPhone sends conversation.item.create with this as a
  // user-style message so the model picks it up on its next response.
  injectQueue({ action: 'inject_realtime_message', args: { text } });
}
