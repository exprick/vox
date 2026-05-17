import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');

export async function dispatchArtifactCreate(spec) {
  const id = `a_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(ARTIFACTS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const lastMsgPath = path.join(dir, '_last_message.txt');
  const prompt = renderPrompt(spec);

  const t0 = Date.now();
  const run = await runCodex({ cwd: dir, lastMsgPath, prompt });
  const elapsedMs = Date.now() - t0;

  const files = await listArtifactFiles(dir);
  const ok = run.code === 0 && files.length > 0;
  if (ok) await updateLatestSymlink(id);
  return {
    artifact_id: id,
    artifact_dir: dir,
    files,
    elapsed_ms: elapsedMs,
    exit_code: run.code,
    last_message: run.lastMessage.trim(),
    ok,
  };
}

async function updateLatestSymlink(targetId) {
  const link = path.join(ARTIFACTS_DIR, 'latest');
  const tmp = path.join(ARTIFACTS_DIR, `.latest.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(2).toString('hex')}`);
  await fs.symlink(targetId, tmp);
  try {
    await fs.rename(tmp, link);
  } catch (e) {
    try { await fs.unlink(tmp); } catch {}
    throw e;
  }
}

function renderPrompt(spec) {
  const lines = [
    `Generate a ${spec.artifact_type ?? 'speaking_drill'} for Vox (a language learning agent).`,
    `Target language: ${spec.target_language ?? 'en'}.`,
    `Topic / scenario: ${spec.topic}.`,
  ];
  if (Array.isArray(spec.fossils) && spec.fossils.length) {
    lines.push(`Fossilized errors to embed for practice: ${spec.fossils.join(', ')}.`);
  }
  lines.push(
    '',
    'Output ONE self-contained HTML file in the current working directory named index.html.',
    'Requirements:',
    '- Mobile-friendly (viewport meta + responsive layout).',
    '- 5 questions appropriate for the topic, multiple-choice (3 options each, A/B/C).',
    '- Expose a global window.voxArtifact with getState(), submit(), snapshotLabel() hooks.',
    '- No external CDN dependencies; pure HTML/CSS/inline JS.',
    '',
    'Just write the file and exit. Do not ask follow-up questions.'
  );
  return lines.join('\n');
}

function runCodex({ cwd, lastMsgPath, prompt }) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      '--full-auto',
      '--skip-git-repo-check',
      '-C', cwd,
      '--output-last-message', lastMsgPath,
      prompt,
    ];
    const proc = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', async (code) => {
      let lastMessage = '';
      try { lastMessage = await fs.readFile(lastMsgPath, 'utf-8'); } catch {}
      resolve({ code, stdout, stderr, lastMessage });
    });
  });
}

async function listArtifactFiles(dir) {
  const entries = await fs.readdir(dir);
  return entries
    .filter((f) => !f.startsWith('_'))
    .map((f) => path.join(dir, f));
}
