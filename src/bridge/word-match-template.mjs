// Self-contained HTML for the word↔meaning matching mini-game.
// Templated (no codex spawn) — deterministic + fast. Codex-generated variants
// can be added via the existing /artifact/create route if needed.

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');

export async function createWordMatchArtifact({ topic, pairs }) {
  if (!topic || typeof topic !== 'string') throw new Error('topic must be a non-empty string');
  if (!Array.isArray(pairs) || pairs.length === 0) throw new Error('pairs must be a non-empty array');
  if (pairs.length > 12) throw new Error('pairs must have <= 12 entries (UI overflow)');
  for (const p of pairs) {
    if (!p || typeof p.en !== 'string' || typeof p.zh !== 'string') {
      throw new Error('each pair must be { en: string, zh: string }');
    }
  }

  const id = `wm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const dir = path.join(ARTIFACTS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const html = renderHtml({ topic, pairs });
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/// Escape JSON for embedding inside an inline <script> block. JSON.stringify
/// alone is JS-safe but not HTML-safe — `</script>` in any user-supplied
/// pair value would terminate the script tag and let an attacker inject HTML.
/// Backslash-u escape the dangerous trio so the literal stays valid JSON
/// and JS while never producing those bytes in the HTML stream. (Codex P1.)
function jsonForScript(obj) {
  // < > & escapes prevent script-tag breakouts. \u2028/\u2029 escapes the
  // JSON-vs-JS string-literal mismatch (legal in JSON, illegal in pre-ES2019
  // JS literals; modern V8 is fine but cheap belt-and-suspenders).
  return JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g, (c) => {
    return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function renderHtml({ topic, pairs }) {
  // Embed pairs as JSON for the JS runtime; HTML body stays minimal.
  // jsonForScript (not bare JSON.stringify) so embedded `</script>` /
  // line-separator chars can't break out. Topic in the JS literal also
  // routes through jsonForScript for the same reason.
  const pairsJson = jsonForScript(pairs);
  const topicJson = jsonForScript(topic);
  const safeTopic = escapeHtml(topic);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Drill — ${safeTopic}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000;
    --tile: #1c1c1e;
    --tile-active: #0a84ff;
    --tile-correct: #30d158;
    --tile-wrong: #ff453a;
    --text: #fff;
    --muted: #8e8e93;
    --border: #2c2c2e;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--text);
    font: -apple-system-body / 1.4 -apple-system, BlinkMacSystemFont, "SF Pro", system-ui, sans-serif;
  }
  body { padding: max(env(safe-area-inset-top), 16px) 16px max(env(safe-area-inset-bottom), 16px); }
  header {
    text-align: center;
    margin-bottom: 16px;
  }
  header h1 {
    font-size: 13px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin: 0 0 4px;
  }
  header p {
    margin: 0; font-size: 22px; font-weight: 700;
    line-height: 1.2;
  }
  #status {
    text-align: center; color: var(--muted);
    font-size: 14px; margin: 12px 0 16px;
    min-height: 20px;
  }
  #status.win { color: var(--tile-correct); font-weight: 700; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .tile {
    background: var(--tile);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px 12px;
    font-size: 17px; font-weight: 500;
    text-align: center;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s, border-color 0.15s, transform 0.1s, opacity 0.3s;
    min-height: 56px;
    display: flex; align-items: center; justify-content: center;
    word-break: break-word;
  }
  .tile:active { transform: scale(0.97); }
  .tile.active {
    background: var(--tile-active); border-color: var(--tile-active);
  }
  .tile.correct {
    background: var(--tile-correct); border-color: var(--tile-correct);
    opacity: 0.5;
    pointer-events: none;
  }
  .tile.wrong {
    background: var(--tile-wrong); border-color: var(--tile-wrong);
  }
  footer {
    text-align: center;
    color: var(--muted);
    font-size: 12px;
    margin-top: 24px;
  }
</style>
</head>
<body>
<header>
  <h1>Drill</h1>
  <p>${safeTopic}</p>
</header>
<div id="status">Tap an English word, then its meaning</div>
<div class="grid" id="grid"></div>
<footer id="footer"></footer>
<script>
(function() {
  // ───────── data ─────────
  const PAIRS = ${pairsJson};
  const N = PAIRS.length;
  // Independent shuffles for each column so order is randomized.
  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  }
  const enOrder = shuffle(PAIRS.map((p, i) => i));
  const zhOrder = shuffle(PAIRS.map((p, i) => i));

  // ───────── state ─────────
  const state = {
    matched: new Set(),  // indices into PAIRS that have been matched
    wrong: 0,
    selectedEnIdx: null, // index into PAIRS
    selectedZhIdx: null,
    completed: false,
  };

  // ───────── DOM ─────────
  const grid = document.getElementById('grid');
  const status = document.getElementById('status');
  const footer = document.getElementById('footer');

  // Build grid: alternate columns row-by-row, but since CSS grid is row-major
  // we produce all EN tiles then all ZH tiles in the order [en0, zh0, en1, zh1, ...].
  // Simpler: produce 2*N tiles in order using interleaved arrays.
  const tiles = []; // {kind:'en'|'zh', idx, el}
  for (let row = 0; row < N; row++) {
    const enIdx = enOrder[row];
    const zhIdx = zhOrder[row];
    tiles.push(makeTile('en', enIdx, PAIRS[enIdx].en));
    tiles.push(makeTile('zh', zhIdx, PAIRS[zhIdx].zh));
  }
  for (const t of tiles) grid.appendChild(t.el);

  function makeTile(kind, idx, label) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.kind = kind;
    el.dataset.idx = String(idx);
    el.textContent = label;
    el.addEventListener('click', () => onTileClick(kind, idx, el));
    return { kind, idx, el };
  }

  function onTileClick(kind, idx, el) {
    if (state.completed) return;
    if (state.matched.has(idx) && tilesByPair(idx).every(t => t.el.classList.contains('correct'))) return;

    if (kind === 'en') {
      clearActive('en');
      state.selectedEnIdx = idx;
      el.classList.add('active');
    } else {
      clearActive('zh');
      state.selectedZhIdx = idx;
      el.classList.add('active');
    }
    if (state.selectedEnIdx != null && state.selectedZhIdx != null) {
      checkMatch();
    }
  }

  function clearActive(kind) {
    for (const t of tiles) {
      if (t.kind === kind && t.el.classList.contains('active')) {
        t.el.classList.remove('active');
      }
    }
  }

  function tilesByPair(idx) {
    return tiles.filter(t => t.idx === idx);
  }

  function checkMatch() {
    const enIdx = state.selectedEnIdx;
    const zhIdx = state.selectedZhIdx;
    state.selectedEnIdx = null;
    state.selectedZhIdx = null;

    if (enIdx === zhIdx) {
      state.matched.add(enIdx);
      tilesByPair(enIdx).forEach(t => {
        t.el.classList.remove('active');
        t.el.classList.add('correct');
      });
      if (state.matched.size === N) {
        state.completed = true;
        status.textContent = '✓ All matched! Score: ' + (N - state.wrong) + '/' + N;
        status.classList.add('win');
      } else {
        status.textContent = state.matched.size + '/' + N + ' matched';
      }
    } else {
      state.wrong += 1;
      const wrongTiles = [
        ...tiles.filter(t => t.kind === 'en' && t.idx === enIdx),
        ...tiles.filter(t => t.kind === 'zh' && t.idx === zhIdx),
      ];
      wrongTiles.forEach(t => {
        t.el.classList.remove('active');
        t.el.classList.add('wrong');
      });
      setTimeout(() => {
        wrongTiles.forEach(t => t.el.classList.remove('wrong'));
      }, 500);
      status.textContent = '✗ Try again — ' + state.matched.size + '/' + N + ' matched, ' + state.wrong + ' wrong';
    }
    footer.textContent = 'Topic: ${safeTopic.replace(/'/g, "\\'")}';
  }

  // ───────── public API ─────────
  window.voxArtifact = {
    kind: 'word_match',
    topic: ${topicJson},
    pairs: PAIRS,
    getState() {
      return {
        kind: 'word_match',
        topic: ${topicJson},
        n: N,
        matched: Array.from(state.matched).sort((a, b) => a - b),
        wrong: state.wrong,
        completed: state.completed,
      };
    },
    submit(en, zh) {
      const enIdx = PAIRS.findIndex(p => p.en === en);
      const zhIdx = PAIRS.findIndex(p => p.zh === zh);
      if (enIdx < 0 || zhIdx < 0) return false;
      state.selectedEnIdx = enIdx;
      state.selectedZhIdx = zhIdx;
      checkMatch();
      return enIdx === zhIdx;
    },
    snapshotLabel() {
      return 'word_match · ' + this.topic + ' · ' + this.pairs.length + ' pairs';
    },
  };
  footer.textContent = 'Topic: ${safeTopic.replace(/'/g, "\\'")}';
})();
</script>
</body>
</html>`;
}
