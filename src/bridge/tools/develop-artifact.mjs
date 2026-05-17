// develop_artifact tool — voice-driven custom artifact via Codex.
//
// Difference from dispatch_codex (general worker):
//   dispatch_codex  → spawns codex in PROJECT_ROOT (or sub), free-form work,
//                     output goes to source code or wherever; Tab 2 doesn't see it
//   develop_artifact → spawns codex in fresh artifacts/<id>/, augments prompt
//                     to REQUIRE self-contained index.html, on completion
//                     updates artifacts/latest + triggers Tab 2 reload
//
// Difference from generate_drill (templated, instant):
//   generate_drill  → templated fill-in-the-blank HTML, ~50ms, deterministic
//   develop_artifact → real Codex run (5–60s), can produce ANY game / quiz /
//                     visualization the user describes
//
// Async pattern same as dispatch_codex: tool returns task_id immediately;
// when codex finishes, bridge pushes a system message back to the live voice
// session so the model proactively voice-reports "your custom drill is ready".

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { recordAppState } from './app-state.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');
const MAX_PROMPT_CHARS = Number(process.env.VOX_MAX_CODEX_PROMPT_CHARS || 50_000);

const tasks = new Map(); // task_id → entry (mirrors codex.mjs shape)

let injectQueue = null;
export function bindCmdEnqueuer(fn) { injectQueue = fn; }

/// Returned from get_codex_tasks alongside dispatch_codex tasks for unified view.
export function getDevelopArtifactTasks() {
  return Array.from(tasks.values()).slice(-20);
}

const PROMPT_PREFIX = `You are Codex, asked by the Vox voice agent to BUILD a custom HTML mini-app for the Vox iOS app's Tab 2.

Hard requirements:
1. Write EXACTLY ONE file named "index.html" in the current working directory. Do not create subdirectories or other files.
2. Self-contained — no <script src=...> CDN deps, no <link href=...> stylesheets, no fetch() calls. All HTML/CSS/JS inline.
3. Mobile-first portrait layout — viewport meta tag, finger-sized tap targets (44x44+), legible text on a 6.7" iPhone screen.
4. Dark theme matching iPhone OS — black background, white text, system font stack.
5. Expose a global hook so the agent can introspect / drive the app for tests:
       window.voxArtifact = {
         kind: '<short-machine-id>',     // e.g. "fill_blank", "tense_drill"
         topic: '<human title>',
         getState() { return { ... } },  // current play state, JSON-serializable
         submit(...) { return bool; },   // optional programmatic input
         snapshotLabel() { return '<one-line label>' },
       };
6. The app is rendered inside a WKWebView already active on Tab 2 — do not assume it can navigate to other URLs.

User request below:
---
`;

const PROMPT_SUFFIX = `\n---

Build the index.html now. After writing, just exit — do not ask follow-up questions.`;

export function developArtifactTool({ prompt }) {
  if (!prompt || typeof prompt !== 'string') {
    return { output: 'error: prompt argument required (string describing the artifact you want built)' };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { output: `error: prompt too long (${prompt.length} chars > ${MAX_PROMPT_CHARS})` };
  }

  // Fresh artifact dir per task — same naming scheme as templated drills
  // so they sort together in the artifacts/ listing.
  const artifact_id = `da_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const artifact_dir = path.join(ARTIFACTS_DIR, artifact_id);

  const task_id = artifact_id; // unify for simpler get_codex_tasks reporting
  const entry = {
    task_id, status: 'preparing', started_at: Date.now(), ended_at: null,
    prompt: prompt.slice(0, 200), cwd: artifact_dir, result: null, error: null,
    artifact_id, artifact_published: false,
  };
  tasks.set(task_id, entry);

  // mkdir, then spawn — done in async IIFE so the tool can return task_id fast.
  (async () => {
    try {
      await fs.mkdir(artifact_dir, { recursive: true });
      entry.status = 'running';
      const fullPrompt = PROMPT_PREFIX + prompt + PROMPT_SUFFIX;
      const args = ['exec', '--full-auto', '--skip-git-repo-check', '-C', artifact_dir, fullPrompt];
      const proc = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        entry.status = 'error';
        entry.error = String(err.message || err);
        entry.ended_at = Date.now();
        pushBack(entry, `develop_artifact spawn error: ${entry.error}`);
      });
      proc.on('exit', async (code) => {
        entry.ended_at = Date.now();
        const indexPath = path.join(artifact_dir, 'index.html');
        const wrote = existsSync(indexPath);
        if (code === 0 && wrote) {
          // Promote to latest + tell iOS to reload Tab 2.
          // Catch publish errors so a failed symlink rename doesn't strand
          // the task in pre-published state with no completion message
          // (codex review P2b regression). On failure: still tell the model.
          let publishOk = true;
          let publishErr = null;
          try {
            await updateLatestSymlink(artifact_id);
          } catch (e) {
            publishOk = false;
            publishErr = e.message || String(e);
          }
          if (publishOk) {
            recordAppState({ drill: { kind: 'custom', topic: 'Custom artifact', answered: 0, correct: 0, wrong: 0, completed: false } });
            if (injectQueue) {
              injectQueue({ action: 'switch_tab', args: { tab: 1 } });
              injectQueue({ action: 'reload_drill', args: {} });
            }
            entry.status = 'done';
            entry.artifact_published = true;
            entry.result = (stdout.trim().split('\n').slice(-6).join('\n') || '(no stdout)').slice(0, 600);
            pushBack(entry, formatSuccess(entry));
          } else {
            entry.status = 'failed';
            entry.error = `wrote index.html but publish failed: ${publishErr}`;
            entry.result = (stdout.trim().slice(-400)) || '(no stdout)';
            pushBack(entry, `develop_artifact built ${artifact_id} but publishing to Tab 2 failed: ${publishErr}. The HTML is at artifacts/${artifact_id}/index.html if the learner wants to inspect it.`);
          }
        } else if (code === 0 && !wrote) {
          entry.status = 'failed';
          entry.error = 'codex exited 0 but did not write index.html';
          entry.result = (stdout.trim().slice(-400)) || (stderr.trim().slice(-400));
          pushBack(entry, `develop_artifact: ${entry.error}. Output excerpt:\n${entry.result}`);
        } else {
          entry.status = 'failed';
          entry.error = `codex exit ${code}`;
          entry.result = (stdout.trim().slice(-400)) || (stderr.trim().slice(-400));
          pushBack(entry, `develop_artifact ${entry.error}.\n${entry.result}`);
        }
      });
    } catch (e) {
      entry.status = 'error';
      entry.error = String(e.message || e);
      entry.ended_at = Date.now();
      pushBack(entry, `develop_artifact pre-spawn error: ${entry.error}`);
    }
  })();

  return {
    output: JSON.stringify({
      task_id,
      artifact_id,
      status: 'running',
      started_at: entry.started_at,
      message: `Codex started building your custom artifact in ${artifact_id}. I will tell you when it lands on Tab 2 (typically 30–90 seconds).`,
    }),
  };
}

async function updateLatestSymlink(artifactId) {
  // Atomic publish: write a unique-name temp symlink, then rename over `latest`.
  // rename(2) on POSIX is atomic w.r.t. any concurrent reader and survives a
  // concurrent symlink call from a sibling task — without this, two
  // develop_artifact tasks finishing close together race in unlink+symlink and
  // one throws EEXIST. (Codex review P2b.)
  const link = path.join(ARTIFACTS_DIR, 'latest');
  const tmp = path.join(ARTIFACTS_DIR, `.latest.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`);
  await fs.symlink(artifactId, tmp);
  try {
    await fs.rename(tmp, link);
  } catch (e) {
    // Best-effort cleanup of the tmp symlink if rename failed for an
    // unexpected reason; rethrow so the caller knows publish didn't succeed.
    try { await fs.unlink(tmp); } catch {}
    throw e;
  }
}

function formatSuccess(entry) {
  const dur = Math.round((entry.ended_at - entry.started_at) / 1000);
  return `Custom artifact built (${dur}s). Now showing on Tab 2 (artifact id ${entry.artifact_id}). The user has been auto-switched to Tab 2 and the webview has reloaded. Voice-tell the user it is ready and briefly describe what was built (codex's last output snippet: ${entry.result?.slice(0, 200) || '(empty)'}).`;
}

function pushBack(entry, text) {
  if (!injectQueue) return;
  injectQueue({ action: 'inject_realtime_message', args: { text } });
}
