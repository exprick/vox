# DoD: voice-auth-realtime

## Scope

Vox Web App MVP gates live voice practice behind account login, opens a real OpenAI Realtime WebRTC conversation, and stores a recording for every started voice session.

## User Story

- As a learner, I land on `/voice-course/`, sign in with Google, and can start a live voice conversation.
- If I am not signed in or not allowed, the app does not mint an OpenAI Realtime token.
- When I end a voice session, Vox uploads the browser recording to the bridge for debugging and later teaching analysis.

## Objective Proof

- Server:
  - `GET /api/config` returns public auth settings without secrets.
  - `POST /voice/session` returns `401` without a valid bearer token when auth is required.
  - `POST /voice/session` can be smoke-tested in dev mode without Supabase by setting `VOX_AUTH_REQUIRED=0`.
  - `POST /api/recordings` writes one metadata JSON file and one audio file under `VOX_RECORDINGS_DIR`.
  - `GET /api/recordings` lists saved recordings without returning raw audio bytes.
- Web:
  - Mobile and desktop browser screenshots show a login gate when auth config is present.
  - With dev auth disabled, clicking Start requests mic permission, opens WebRTC, and shows Live/Connecting state.
  - Ending or disconnecting uploads a recording if the browser produced audio data.
- Deployment:
  - The Node bridge can serve `web/` on the Vox production port, replacing the static-only Python server.

## Commands

```bash
npm test
VOX_AUTH_REQUIRED=0 PORT=3203 HOST=127.0.0.1 VOX_RECORDINGS_DIR=/tmp/vox-recordings-test node src/bridge/server.mjs
curl -s http://127.0.0.1:3203/api/config
curl -i -X POST http://127.0.0.1:3203/voice/session -H 'content-type: application/json' -d '{}'
```

## Subjective / Manual

- `[subjective: live voice quality]` A human still needs to speak to Vox and judge whether the tutoring behavior feels useful; automated checks only prove the login, transport, transcript, and recording plumbing.
- Supabase Google OAuth setup may require Rick to configure project URL, anon key, redirect URLs, and allowlist values outside this repo.

TF impact: not-needed — follow-up hardening for filename entropy, small ignored request bodies, and auth-expiry stop-state behavior stays within the existing recording-save truth already added to TRUTHFILE.md and web/tf/index.html.

TF impact: not-needed — follow-up hardening for pending recording ownership, recorder shutdown order, and ignored voice-session request bodies does not change the product promise already documented as truthful recording-save status.

TF impact: not-needed — root URL now redirects to the already documented Voice Course app so shared `https://vox.exp.game/` opens the current no-login prototype directly.

TF impact: not-needed — restores the original Vox voice-course visual shell for the already documented no-login Realtime prototype without changing the published product promise.

TF impact: not-needed — final review cleanup only scopes the preview shell and copy labels; the no-login Realtime and recording behavior remains unchanged.

TF impact: not-needed — push-review cleanup only delays the public visual shell until no-login config is known; published Vox behavior remains the same.

TF impact: not-needed — final push-review cleanup limits transcript re-rendering to shell-mode changes and preserves the same public no-login voice UI.

TF impact: not-needed — last review nits only remove redundant guards and clarify startup render order; user-visible Realtime behavior is unchanged.

TF impact: not-needed — Realtime turn-taking now waits for learner speech and uses less aggressive VAD defaults, preserving the documented no-login voice and recording behavior while reducing self-interrupting fragments.
