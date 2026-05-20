// Bridge-side mirror of what the iOS app is showing right now. iPhone POSTs
// here on surface changes and each user/assistant transcript turn. Vox's
// get_app_state tool reads this so it can answer what is on screen or what
// the learner just said without guessing.

const STATE = {
  surface: 'unknown',              // 'voice' | 'unknown'
  recent_transcript: [],           // [{ role:'user'|'assistant', text, ts }] capped at MAX
  updated_at: 0,
};
const TRANSCRIPT_MAX = 20;

export function recordAppState(patch) {
  if (patch.surface !== undefined) STATE.surface = patch.surface;
  if (patch.tab === 'voice') STATE.surface = 'voice';
  if (Array.isArray(patch.transcript_append)) {
    for (const turn of patch.transcript_append) {
      if (turn && typeof turn.role === 'string' && typeof turn.text === 'string') {
        STATE.recent_transcript.push({ role: turn.role, text: turn.text, ts: turn.ts || Date.now() });
      }
    }
    if (STATE.recent_transcript.length > TRANSCRIPT_MAX) {
      STATE.recent_transcript = STATE.recent_transcript.slice(-TRANSCRIPT_MAX);
    }
  }
  STATE.updated_at = Date.now();
  return { ok: true };
}

export function getAppStateTool() {
  // Returned to the LLM as JSON string. Keep it concise — Realtime context
  // window matters and the model just needs the latest snapshot.
  return {
    output: JSON.stringify({
      surface: STATE.surface,
      recent_transcript: STATE.recent_transcript.slice(-10),
      updated_at_ms_ago: STATE.updated_at ? Date.now() - STATE.updated_at : null,
    }),
  };
}

export function snapshot() { return { ...STATE }; }
