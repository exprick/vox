// Lets Vox rewrite its own system prompt mid-conversation.
//
// Two parts:
//   1. Persistence — write data/system_prompt.txt; voice.mjs reads this on
//      every /voice/session call (with VOX_INSTRUCTIONS as fallback)
//   2. Live update — enqueue a PollClient cmd to iPhone so it sends
//      session.update with the new instructions on the live data channel
//      (no need to disconnect/reconnect the WebRTC session)
//
// Without #2, the change would only take effect on the NEXT session.

import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PROMPT_PATH = path.join(PROJECT_ROOT, 'data', 'system_prompt.txt');

let injectQueue = null; // set by server.mjs at boot

/// server.mjs wires this so this tool can enqueue cmds for iPhone PollClient.
export function bindCmdEnqueuer(fn) { injectQueue = fn; }

export async function readSystemPromptFromFile() {
  try {
    return await fs.readFile(PROMPT_PATH, 'utf-8');
  } catch {
    return null;
  }
}

export async function readSystemPromptTool() {
  const text = await readSystemPromptFromFile();
  if (text === null) {
    return { output: '(no overridden prompt — using VOX_INSTRUCTIONS default from voice.mjs)' };
  }
  return { output: text };
}

export async function updateSystemPromptTool({ prompt }) {
  if (!prompt || typeof prompt !== 'string') {
    return { output: 'error: prompt argument required (string)' };
  }
  await fs.mkdir(path.dirname(PROMPT_PATH), { recursive: true });
  await fs.writeFile(PROMPT_PATH, prompt, 'utf-8');

  // Push live update to iPhone so the active WebRTC session reflects the new
  // prompt without reconnecting. iOS PollClient.action=update_session_instructions
  // sends session.update on its data channel.
  if (injectQueue) {
    injectQueue({ action: 'update_session_instructions', args: { instructions: prompt } });
  }
  return { output: `system prompt updated (${prompt.length} chars). Live session refreshed.` };
}
