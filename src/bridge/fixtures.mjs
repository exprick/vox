import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURES_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures');

// Each fixture is a list of (voice, text) segments — concat'd to allow ZH+EN code-switching.
// macOS `say` voices: Samantha (en_US), Daniel (en_GB), Tingting (zh_CN).
export const FIXTURES = [
  {
    id: 'greet-en',
    description: 'pure English greeting + ordering food intent',
    expect: 'engages warmly with ordering food, short reply',
    segments: [
      { voice: 'Samantha', text: "Hi, I want to practice ordering food at a restaurant." },
    ],
  },
  {
    id: 'travel-mixed',
    description: 'ZH-EN code-switching: setup in Chinese, ask English help',
    expect: 'agrees, offers small-talk scenario; replies in English',
    segments: [
      { voice: 'Tingting', text: '我下周去欧洲玩，' },
      { voice: 'Samantha', text: 'can you help me practice some small talk?' },
    ],
  },
  {
    id: 'fossil-error-en',
    description: 'pure-English fossil drill (interested about → in)',
    expect: 'recasts naturally to "interested in" without lecturing',
    segments: [
      { voice: 'Samantha', text: "I'm interested about ordering a coffee." },
    ],
  },
  {
    id: 'word-question-mixed',
    description: 'ZH wrapper + EN phrase question',
    expect: 'briefly explains "check please" in context of paying',
    segments: [
      { voice: 'Tingting', text: '请问 ' },
      { voice: 'Samantha', text: 'check please ' },
      { voice: 'Tingting', text: '是什么意思？' },
    ],
  },
  {
    id: 'greet-zh',
    description: 'pure Chinese intent statement',
    expect: 'briefly acknowledges in Chinese, then guides into English practice',
    segments: [
      { voice: 'Tingting', text: '你好，今天我想练点旅行用的英语。' },
    ],
  },
];

export async function generateAll({ force = false } = {}) {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  const results = [];
  for (const fx of FIXTURES) {
    const result = await generateOne(fx, { force });
    results.push(result);
  }
  return results;
}

async function generateOne(fx, { force }) {
  const wav = path.join(FIXTURES_DIR, `${fx.id}.wav`);
  const pcm = path.join(FIXTURES_DIR, `${fx.id}.pcm`);
  if (!force) {
    try {
      await fs.access(pcm);
      await fs.access(wav);
      return { id: fx.id, wav, pcm, cached: true };
    } catch {}
  }

  const partAiffs = [];
  for (let i = 0; i < fx.segments.length; i++) {
    const seg = fx.segments[i];
    const partAiff = path.join(FIXTURES_DIR, `${fx.id}.part${i}.aiff`);
    await runCmd('say', ['-v', seg.voice, '-o', partAiff, seg.text]);
    partAiffs.push(partAiff);
  }

  // Concat parts using ffmpeg concat demuxer
  const listFile = path.join(FIXTURES_DIR, `${fx.id}.concat.txt`);
  await fs.writeFile(listFile, partAiffs.map((p) => `file '${p}'`).join('\n'));
  const combinedAiff = path.join(FIXTURES_DIR, `${fx.id}.combined.aiff`);
  await runCmd('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', combinedAiff]);

  // Produce 24kHz 16-bit mono WAV (for afplay) AND raw PCM s16le (for direct WS feed)
  await runCmd('ffmpeg', ['-y', '-i', combinedAiff, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  await runCmd('ffmpeg', ['-y', '-i', combinedAiff, '-ar', '24000', '-ac', '1', '-f', 's16le', pcm]);

  // Cleanup intermediate
  for (const p of [...partAiffs, listFile, combinedAiff]) {
    try { await fs.unlink(p); } catch {}
  }

  return { id: fx.id, wav, pcm, cached: false };
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const force = process.argv.includes('--force');
  const results = await generateAll({ force });
  for (const r of results) {
    console.log(`${r.cached ? 'cached' : 'built '}  ${r.id.padEnd(22)}  ${r.wav}`);
  }
}
