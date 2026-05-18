# DoD: voice-web-push-to-talk

## User Story

- As a mobile web learner using speaker output, I tap once to start speaking and tap again to send that utterance to Vox.
- Vox must not keep the microphone open while it is speaking back.

## Objective Proof

- Web session creation requests `manual_input_turns: true`.
- Manual input sessions set Realtime `audio.input.turn_detection` to `null`.
- The web client sends `input_audio_buffer.clear` before opening the microphone for a new utterance.
- The web client disables the microphone and sends `input_audio_buffer.commit` when the learner taps Send.
- Browser smoke verifies the voice page renders on desktop and mobile with no horizontal overflow and the primary button is present.

## Subjective / Manual

- `[subjective: physical iPhone speaker echo]` Local browser smoke cannot prove physical room echo suppression on an iPhone speaker. The objective proof is that the page no longer captures microphone audio while Vox is speaking.

TF impact: not-needed -- mobile web push-to-talk changes the interaction mechanics of the already documented Realtime voice course to prevent speaker echo; it does not add a new product promise beyond the existing voice course behavior.
