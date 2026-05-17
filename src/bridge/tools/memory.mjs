// Read and write Vox's local per-project memory files.

import fs from 'node:fs/promises';
import path from 'node:path';

const MEMORY_DIR = process.env.VOX_MEMORY_DIR || path.join(process.cwd(), '.vox-memory');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

export async function listMemoryTool() {
  try {
    const files = await fs.readdir(MEMORY_DIR);
    const items = [];
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(path.join(MEMORY_DIR, f), 'utf-8');
        const fm = parseFrontmatter(content);
        items.push({
          file: f,
          name: fm.name || f.replace(/\.md$/, ''),
          description: fm.description || '',
          type: fm.type || 'unknown',
        });
      } catch {}
    }
    return { output: JSON.stringify(items) };
  } catch (e) {
    return { output: JSON.stringify({ error: `cannot read memory dir: ${e.message}` }) };
  }
}

export async function readMemoryTool({ file }) {
  if (!file || typeof file !== 'string') {
    return { output: 'error: file argument required (use list_memory to see options)' };
  }
  // Strip any path separators — only allow files in the memory dir, not traversal.
  const safe = path.basename(file);
  const fullPath = path.join(MEMORY_DIR, safe);
  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    // Truncate to keep Realtime context manageable. Most memory files are
    // 50-200 lines; cap at 4000 chars (~800 tokens) and tell the model.
    const MAX = 4000;
    if (content.length > MAX) {
      return { output: content.slice(0, MAX) + `\n\n[truncated; full file is ${content.length} chars]` };
    }
    return { output: content };
  } catch (e) {
    return { output: `error reading ${safe}: ${e.message}` };
  }
}

const ALLOWED_TYPES = new Set(['project', 'feedback', 'reference', 'user']);
const SAFE_FILENAME_RE = /^[a-z0-9_-]+(\.md)?$/i;

export async function writeMemoryTool({ file, name, description, type, content }) {
  // Validate every field — this writes to Claude's persistent memory dir, so
  // bad inputs would corrupt sediment for all future sessions.
  if (!file || !name || !description || !type || !content) {
    return { output: 'error: required fields are file, name, description, type, content' };
  }
  if (!ALLOWED_TYPES.has(type)) {
    return { output: `error: type must be one of: ${[...ALLOWED_TYPES].join(', ')}` };
  }
  // Reject path traversal — only allow plain filenames (no slashes, no ..).
  if (!SAFE_FILENAME_RE.test(file)) {
    return { output: 'error: file must be a plain filename (a-z, 0-9, _, -, optional .md). No paths.' };
  }
  const safe = file.endsWith('.md') ? file : `${file}.md`;
  const fullPath = path.join(MEMORY_DIR, safe);

  // Don't accidentally let \n in name/description break the YAML frontmatter.
  const cleanName = String(name).replace(/[\r\n]+/g, ' ').trim();
  const cleanDesc = String(description).replace(/[\r\n]+/g, ' ').trim();

  const body = `---\nname: ${cleanName}\ndescription: ${cleanDesc}\ntype: ${type}\n---\n\n${content}\n`;
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    // Tell the model whether this was a NEW file or an OVERWRITE — useful so
    // it doesn't accidentally clobber existing memories without saying so.
    let existed = false;
    try { await fs.access(fullPath); existed = true; } catch {}
    await fs.writeFile(fullPath, body, 'utf-8');
    return {
      output: `${existed ? 'updated' : 'created'} memory: ${safe} (${body.length} bytes, type=${type})`,
    };
  } catch (e) {
    return { output: `error writing ${safe}: ${e.message}` };
  }
}
