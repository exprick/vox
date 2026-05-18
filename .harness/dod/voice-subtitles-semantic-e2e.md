# DoD: voice-subtitles-semantic-e2e

<!-- harness-dod
{
  "version": 1,
  "feature": "voice-subtitles-semantic-e2e",
  "types": [
    "program",
    "e2e",
    "visual"
  ],
  "status": "active",
  "created": "2026-05-18",
  "checks": [
    {
      "id": "C1",
      "type": "program",
      "command": "npm test",
      "expect_exit": 0
    },
    {
      "id": "C2",
      "type": "program",
      "command": "npm run test:e2e:voice:check",
      "expect_exit": 0
    }
  ]
}
-->

## Scope

Restore Vox Web App bilingual subtitle support and make the unattended voice E2E judge transcript health with semantic checks, not just "a request returned 200".

## User Story

- As a learner, I hear Vox speak English and see a small Chinese subtitle attached to that same Vox turn.
- I can turn Chinese subtitles off and on from the small control directly above the main voice button.
- As Rick, I can run one E2E command and get a summary that confirms the simulated user turn, Vox turn, Chinese subtitle, role order, and saved recording are coherent.

## Objective Proof

- UI:
  - The subtitle toggle is visible above the main button and does not replace the primary voice button.
  - Vox assistant turns can render `<p class="zh-subtitle" data-subtitle-role="assistant">...</p>`.
  - User turns do not receive Vox subtitles.
  - The subtitle preference persists in localStorage.
- Backend:
  - `POST /api/translate` returns a concise Simplified Chinese subtitle for assistant English text.
  - Recording transcript sidecars preserve `turn.id`, `text`, `zh`, and `ts`.
- E2E:
  - `OPENAI_API_KEY=... npm run test:e2e:voice:file` simulates user audio and exits 0 only when user text, Vox English text, Chinese subtitle, semantic relevance, role order, and recording persistence all pass.
  - `OPENAI_API_KEY=... npm run test:e2e:voice:loopback` repeats the same checks through `BlackHole 2ch`.

## Subjective / Manual

- `[subjective: translation quality]` The E2E proves the subtitle exists, is Chinese, and is attached to the correct Vox turn. A human or later rubric can still judge whether the translation is elegant.
- `[subjective: iPhone physical audio]` This still does not replace a physical iPhone E2E for AVAudioSession, AirPods, lock screen, or room echo.

TF impact: not-needed -- restores an existing subtitle control, aligns Realtime session defaults with official OpenAI voice-agent guidance, tightens echo filtering, client/server translation failure/timeout/retry/rate-limit/cache/backfill behavior, recording-header bounds, audio E2E cleanup safety, review-blocker follow-ups, and test coverage for the already documented Realtime voice behavior.
