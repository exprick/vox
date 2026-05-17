// Bridge-side mirror of what the iOS app is showing right now. iPhone POSTs
// here on tab switch, drill state change, and on each user/assistant transcript
// turn. Vox's get_app_state tool reads this so it can answer "what tab am
// I on" / "what's the score" / "what did I just say" without guessing.

const STATE = {
  tab: 'unknown',                  // 'voice' | 'drill' | 'unknown'
  drill: null,                     // { kind:'fill_blank', topic, questions, answered, correct, wrong, completed } | null
  recent_transcript: [],           // [{ role:'user'|'assistant', text, ts }] capped at MAX
  updated_at: 0,
};
const TRANSCRIPT_MAX = 20;

export function recordAppState(patch) {
  if (patch.tab !== undefined) STATE.tab = patch.tab;
  if (patch.drill !== undefined) STATE.drill = patch.drill;
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
      tab: STATE.tab,
      drill: STATE.drill,
      recent_transcript: STATE.recent_transcript.slice(-10),
      updated_at_ms_ago: STATE.updated_at ? Date.now() - STATE.updated_at : null,
    }),
  };
}

export function snapshot() { return { ...STATE }; }
