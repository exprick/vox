# Vox

Vox is a local-first voice English tutor prototype.

It combines:

- an iOS SwiftUI Vox Voice surface that adapts the same product shipped at `https://vox.exp.game/`
- a Node.js bridge that serves the web app, gates Realtime sessions, and stores voice recordings

## Status

This repository is a public-safe development snapshot. It intentionally does not include private runtime logs, local agent infrastructure files, personal memory, audio recordings, or device-specific IDs.

## Truthfile

The product source of truth lives in `TRUTHFILE.md`, with the reader-facing version at `web/tf/index.html`.
Keep both in sync when changing Vox's product direction, user-facing capabilities, or delivery boundary.

## Requirements

- Node.js 22+
- Xcode + XcodeGen for the iOS app
- an OpenAI API key with Realtime access
- Supabase Auth with Google OAuth for production login

## Bridge

```bash
npm install
OPENAI_API_KEY=... VOX_AUTH_REQUIRED=0 node src/bridge/server.mjs
```

The bridge listens on `PORT=3203` by default and serves `web/` plus the API routes on the same origin.

Realtime sessions follow the current OpenAI voice-agent recommendations by default: WebRTC client secrets, `gpt-realtime-2`, `reasoning.effort=low`, `voice=marin`, `gpt-realtime-whisper` input transcription, `far_field` input noise reduction for phone/laptop speaker use, and `semantic_vad` with low eagerness so learners can pause. Override with `VOX_REALTIME_MODEL`, `VOX_REALTIME_REASONING_EFFORT`, `VOX_REALTIME_VOICE`, `VOX_TRANSCRIPTION_MODEL`, `VOX_INPUT_NOISE_REDUCTION`, `VOX_VAD_TYPE`, and `VOX_VAD_EAGERNESS` only when a deployment has measured evidence to tune them.

Production login requires:

```bash
OPENAI_API_KEY=...
VOX_AUTH_REQUIRED=1
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
VOX_ALLOWED_EMAILS=rick@exp.game
VOX_RECORDINGS_DIR=.vox-recordings
node src/bridge/server.mjs
```

Runtime recordings are written under `VOX_RECORDINGS_DIR` and must not be committed.

Requests that arrive through a proxy or public tunnel must pass Supabase auth before they can mint Realtime sessions, call tools, poll commands, or read uploaded artifacts. For simulator-only bridge development, `VOX_ALLOW_LOCAL_BRIDGE_BYPASS=1` allows no-token loopback calls only when both the remote address and `Host` header are localhost/127.0.0.1; keep it disabled in production.

## Voice E2E

The unattended Web voice E2E harness starts the bridge, opens Chromium, feeds a fixed learner utterance into `/voice-course/`, waits for a user turn, a Vox turn, and a Chinese Vox subtitle, runs semantic transcript checks, ends the call, and verifies that a recording was saved.

```bash
npm run test:e2e:voice:check
npm run test:e2e:voice:loopback
```

The runner reads `.env` when present, without overriding exported environment variables. The default `loopback` mode expects a macOS virtual audio device such as `BlackHole 2ch` or Loopback and uses `SwitchAudioSource` to route `afplay` into the browser microphone path. Set `VOX_E2E_LOOPBACK_DEVICE` when the device has a different name. `npm run test:e2e:voice:file` uses Chromium's file-backed fake microphone input as a CI fallback, but it is not a substitute for loopback or real iPhone testing.

## iOS

Generate and build the Xcode project:

```bash
cd ios
xcodegen generate
open Vox.xcodeproj
```

For device install via script, provide your own IDs:

```bash
VOX_DEVICE_ECID=... VOX_DEVICE_UUID=... VOX_BRIDGE_BASE=http://<mac-lan-ip>:3203 VOX_BUNDLE_ID=game.exp.vox bash scripts/build-install.sh
npm run test:e2e:ios:smoke -- --voice
```

LAN bridge URLs are temporary by default, so a real device falls back to `https://vox.exp.game` after a normal relaunch unless `VOX_BRIDGE_PERSIST=1` is set explicitly.

## Public Repo Rules

- Do not commit `.env`, API keys, device identifiers, private logs, recordings, or generated agent memory.
- Keep project-specific private instructions outside this repository.
- Use pull requests for changes to `main`.
