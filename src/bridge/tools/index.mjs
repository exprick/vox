// Tool registry — single source of truth for what Vox can do via
// Realtime function calls. Add a new tool: implement here, declaration shows
// up automatically in TOOL_DEFINITIONS for /voice/session.

import {
  recordAppState,
  getAppStateTool,
  snapshot as appStateSnapshot,
} from './app-state.mjs';
import { listMemoryTool, readMemoryTool, writeMemoryTool } from './memory.mjs';
import {
  readSystemPromptTool,
  updateSystemPromptTool,
  bindCmdEnqueuer as bindPromptEnqueuer,
} from './system-prompt.mjs';
import {
  dispatchCodexTool,
  getCodexTasksTool,
  getTaskTable as codexTaskTable,
  bindCmdEnqueuer as bindCodexEnqueuer,
} from './codex.mjs';

export { recordAppState, appStateSnapshot, codexTaskTable };

/// Wire the cross-tool callback (push-message-to-iphone) once at server boot.
export function bindToolCmdEnqueuer(fn) {
  bindPromptEnqueuer(fn);
  bindCodexEnqueuer(fn);
}

/// Realtime session.tools array — declared at session create.
/// JSON schema for parameters is what the model will fill in.
export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'get_app_state',
    description:
      'Returns what the user is currently seeing in Vox Voice, plus the ' +
      'recent conversation transcript window. Call this when the user asks ' +
      'what is on screen or what was just said.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'list_memory',
    description:
      'List the agent\'s own per-project memory entries. Returns name, ' +
      'description, type for each memory. Use ' +
      'when the user asks what you remember or what you have learned.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: 'read_memory',
    description:
      'Read the full content of one memory file. Provide the file name from ' +
      'list_memory. Use to recall a specific learned policy or fact.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'memory file name e.g. "feedback_codex_confirm_apple_bug.md"' },
      },
      required: ['file'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'update_system_prompt',
    description:
      'Rewrite the agent\'s own system prompt. Persists to disk AND applies ' +
      'live to the current voice session (no reconnect needed). Use when the ' +
      'user asks you to change your style, tone, correction strategy, or any ' +
      'behavior — only after confirming with them what the new prompt should be.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'the full new system prompt content' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'write_memory',
    description:
      'Save a new memory file (or overwrite an existing one) into the agent\'s ' +
      'per-project memory dir. Use to persist a learning insight, a learner ' +
      'preference, a project fact, or a reference URL — anything you want ' +
      'future sessions to remember without you re-deriving it. ALWAYS confirm ' +
      'with the user out loud before writing, since this affects future ' +
      'agent behavior. Choose `type` carefully: feedback (user correction / ' +
      'preference rule), project (in-flight work / decision), reference ' +
      '(pointer to external resource), user (info about the learner).',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'plain filename, snake_case, e.g. "feedback_use_metric_units" (no .md needed; no slashes)' },
        name: { type: 'string', description: 'short human title, one line' },
        description: { type: 'string', description: 'one-line summary used for relevance matching in future sessions' },
        type: { type: 'string', enum: ['feedback', 'project', 'reference', 'user'] },
        content: { type: 'string', description: 'markdown body — full reasoning + when to apply' },
      },
      required: ['file', 'name', 'description', 'type', 'content'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_codex_tasks',
    description:
      'List recent Codex worker tasks the agent has dispatched (newest first). ' +
      'Each entry shows status (running / done / failed), elapsed seconds, ' +
      'prompt summary, working dir, and a short result excerpt. Use to answer ' +
      '"is the codex task done", "what was that codex doing", or to recall ' +
      'what was just built.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'how many recent tasks to return (default 5, max 20)' },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'dispatch_codex',
    description:
      'Spawn a local Codex CLI session on the Mac to do a coding task. ' +
      'Returns task_id immediately while Codex runs in the background; when ' +
      'it finishes (5–60 seconds typical, longer for self-fix loops), the result is automatically inserted into ' +
      'this conversation as a new message — you do not need to poll. While ' +
      'waiting, voice-acknowledge the user ("ok, I am asking Codex…") and ' +
      'continue conversation. Codex automatically reads AGENTS.md at project ' +
      'root which documents the test suites, bridge endpoints, PollClient ' +
      'commands, and how to verify changes (rebuild iOS, restart bridge, run ' +
      'E2E). For "fix bug X and verify": ask Codex in one prompt — it can ' +
      'self-loop. Use for: source code changes, refactors, bug investigation ' +
      'and self-fix, exploring files, running shell commands. Do NOT use for ' +
      'simple lookups you can answer yourself.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'natural-language task for Codex' },
        working_dir: {
          type: 'string',
          description: 'optional cwd for codex (relative to project root or absolute); defaults to project root',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
];

/// Dispatch by name. Returns { output: string }.
export async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'get_app_state':       return getAppStateTool();
    case 'list_memory':         return await listMemoryTool();
    case 'read_memory':         return await readMemoryTool(args);
    case 'write_memory':        return await writeMemoryTool(args);
    case 'update_system_prompt':return await updateSystemPromptTool(args);
    case 'dispatch_codex':      return dispatchCodexTool(args);
    case 'get_codex_tasks':     return getCodexTasksTool(args);
    default:                    return { output: `unknown tool: ${name}` };
  }
}
