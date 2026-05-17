// Self-contained HTML for an English fill-in-the-blank multiple-choice drill.
// Templated (no codex spawn) so Tab 2 generation is deterministic and fast.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');

export async function createFillBlankArtifact({ topic, questions }) {
  if (!topic || typeof topic !== 'string') throw new Error('topic must be a non-empty string');
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('questions must be a non-empty array');
  if (questions.length > 12) throw new Error('questions must have <= 12 entries (UI overflow)');
  const normalized = questions.map(normalizeQuestion);

  const id = `fb_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(ARTIFACTS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const html = renderHtml({ topic, questions: normalized });
  await fs.writeFile(path.join(dir, 'index.html'), html, 'utf-8');
  await updateLatestSymlink(id);
  return { artifact_id: id, artifact_dir: dir };
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

function normalizeQuestion(q) {
  if (!q || typeof q.sentence !== 'string' || typeof q.answer !== 'string' || !Array.isArray(q.options)) {
    throw new Error('each question must be { sentence: string, answer: string, options: string[] }');
  }
  const sentence = q.sentence.trim();
  const answer = q.answer.trim();
  const options = [...new Set(q.options.map((o) => typeof o === 'string' ? o.trim() : '').filter(Boolean))];
  if (!sentence) throw new Error('question sentence must be non-empty');
  if (!sentence.includes('____')) throw new Error('question sentence must include ____ for the blank');
  if (!answer) throw new Error('question answer must be non-empty');
  if (options.length < 3 || options.length > 4) throw new Error('each question must have 3 or 4 options');
  if (!options.includes(answer)) throw new Error('question options must include the answer');
  return { sentence, answer, options };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g, (c) => {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function renderHtml({ topic, questions }) {
  const questionsJson = jsonForScript(questions);
  const topicJson = jsonForScript(topic);
  const safeTopic = escapeHtml(topic);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Fill Blank — ${safeTopic}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000;
    --panel: #1c1c1e;
    --option: #2c2c2e;
    --accent: #0a84ff;
    --correct: #30d158;
    --wrong: #ff453a;
    --text: #fff;
    --muted: #8e8e93;
    --border: #3a3a3c;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0; padding: 0; min-height: 100%;
    background: var(--bg); color: var(--text);
    font: -apple-system-body / 1.4 -apple-system, BlinkMacSystemFont, "SF Pro", system-ui, sans-serif;
  }
  body { padding: max(env(safe-area-inset-top), 16px) 16px max(env(safe-area-inset-bottom), 18px); }
  header { text-align: center; margin-bottom: 14px; }
  header h1 {
    font-size: 13px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--muted); margin: 0 0 4px;
  }
  header p { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.2; }
  #progress {
    height: 6px; border-radius: 999px; background: var(--panel);
    overflow: hidden; margin: 0 0 18px;
  }
  #bar { height: 100%; width: 0%; background: var(--accent); transition: width 0.2s; }
  main {
    min-height: 260px; display: flex; flex-direction: column;
    justify-content: center; gap: 16px;
  }
  #meta { text-align: center; color: var(--muted); font-size: 14px; min-height: 20px; }
  #sentence {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 22px 18px; text-align: center;
    font-size: 24px; font-weight: 700; line-height: 1.28;
    word-break: break-word;
  }
  .blank {
    color: var(--accent); white-space: nowrap;
  }
  #options { display: grid; gap: 10px; }
  .option {
    appearance: none; border: 1px solid var(--border); border-radius: 8px;
    background: var(--option); color: var(--text); min-height: 52px;
    padding: 12px 14px; font: inherit; font-size: 18px; font-weight: 600;
    text-align: center; cursor: pointer; transition: transform 0.1s, background 0.15s, border-color 0.15s, opacity 0.15s;
  }
  .option:active { transform: scale(0.98); }
  .option.correct { background: var(--correct); border-color: var(--correct); }
  .option.wrong { background: var(--wrong); border-color: var(--wrong); }
  .option.dim { opacity: 0.42; }
  #footer { text-align: center; color: var(--muted); font-size: 13px; min-height: 20px; margin-top: 12px; }
  #next {
    display: none; width: 100%; height: 50px; border: 0; border-radius: 999px;
    background: var(--accent); color: white; font-size: 18px; font-weight: 700;
  }
  #next.visible { display: block; }
</style>
</head>
<body>
<header>
  <h1>Fill in the Blank</h1>
  <p>${safeTopic}</p>
</header>
<div id="progress"><div id="bar"></div></div>
<main>
  <div id="meta"></div>
  <div id="sentence"></div>
  <div id="options"></div>
  <button id="next" type="button">Next</button>
</main>
<div id="footer"></div>
<script>
(function() {
  const QUESTIONS = ${questionsJson};
  const topic = ${topicJson};
  const state = {
    current: 0,
    answered: 0,
    correct: 0,
    wrong: 0,
    completed: false,
    answers: [],
  };

  const meta = document.getElementById('meta');
  const sentence = document.getElementById('sentence');
  const optionsEl = document.getElementById('options');
  const footer = document.getElementById('footer');
  const next = document.getElementById('next');
  const bar = document.getElementById('bar');

  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }

  function render() {
    const q = QUESTIONS[state.current];
    const progress = QUESTIONS.length ? (state.answered / QUESTIONS.length) * 100 : 0;
    bar.style.width = progress + '%';
    next.classList.remove('visible');
    meta.textContent = 'Question ' + (state.current + 1) + ' of ' + QUESTIONS.length;
    sentence.innerHTML = escapeHtml(q.sentence).replace('____', '<span class="blank">____</span>');
    optionsEl.innerHTML = '';
    for (const option of shuffle(q.options)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option';
      btn.textContent = option;
      btn.addEventListener('click', () => choose(option, btn));
      optionsEl.appendChild(btn);
    }
    footer.textContent = 'Score: ' + state.correct + '/' + state.answered;
  }

  function choose(option, btn) {
    if (state.completed) return;
    if (state.answers[state.current]) return;
    const q = QUESTIONS[state.current];
    const ok = option === q.answer;
    state.answered += 1;
    if (ok) state.correct += 1;
    else state.wrong += 1;
    state.answers[state.current] = { selected: option, correct: ok };
    for (const child of optionsEl.children) {
      child.disabled = true;
      if (child.textContent === q.answer) child.classList.add('correct');
      else if (child === btn) child.classList.add('wrong');
      else child.classList.add('dim');
    }
    footer.textContent = ok ? 'Correct' : 'Answer: ' + q.answer;
    if (state.answered === QUESTIONS.length) {
      state.completed = true;
      bar.style.width = '100%';
      meta.textContent = 'Complete';
      next.textContent = 'Review Again';
      next.classList.add('visible');
    } else {
      next.textContent = 'Next';
      next.classList.add('visible');
    }
  }

  next.addEventListener('click', () => {
    if (state.completed) {
      state.current = 0;
      state.answered = 0;
      state.correct = 0;
      state.wrong = 0;
      state.completed = false;
      state.answers = [];
    } else {
      state.current += 1;
    }
    render();
  });

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  window.voxArtifact = {
    kind: 'fill_blank',
    topic,
    questions: QUESTIONS,
    getState() {
      return {
        kind: 'fill_blank',
        topic,
        n: QUESTIONS.length,
        current: state.current,
        answered: state.answered,
        correct: state.correct,
        wrong: state.wrong,
        completed: state.completed,
        answers: state.answers.slice(),
      };
    },
    answer(option) {
      const buttons = Array.from(optionsEl.children);
      const btn = buttons.find((b) => b.textContent === option);
      if (!btn) return false;
      const before = state.correct;
      choose(option, btn);
      return state.correct > before;
    },
    snapshotLabel() {
      return 'fill_blank · ' + this.topic + ' · ' + this.questions.length + ' questions';
    },
  };

  render();
})();
</script>
</body>
</html>`;
}
