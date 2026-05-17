# Vox

Vox is a local-first voice English tutor prototype.

It combines:

- an iOS SwiftUI shell with a Voice tab and a Drill tab
- a Node.js bridge that mints OpenAI Realtime ephemeral sessions
- a WKWebView drill surface for generated HTML practice activities

## Status

This repository is a public-safe development snapshot. It intentionally does not include private runtime logs, local agent infrastructure files, personal memory, audio recordings, or device-specific IDs.

## Truthfile

The product source of truth lives in `TRUTHFILE.md`, with the reader-facing version at `web/tf/index.html`.
Keep both in sync when changing Vox's product direction, user-facing capabilities, or delivery boundary.

## Requirements

- Node.js 22+
- Xcode + XcodeGen for the iOS app
- an OpenAI API key with Realtime access

## Bridge

```bash
npm install
OPENAI_API_KEY=... node src/bridge/server.mjs
```

The bridge listens on `PORT=3205` by default. For a physical iPhone, set the app's `bridgeBase` user default or edit the local bridge URL for your LAN.

## iOS

Generate and build the Xcode project:

```bash
cd ios
xcodegen generate
open Vox.xcodeproj
```

For device install via script, provide your own IDs:

```bash
VOX_DEVICE_ECID=... VOX_DEVICE_UUID=... VOX_BUNDLE_ID=com.example.vox bash scripts/build-install.sh
```

## Public Repo Rules

- Do not commit `.env`, API keys, device identifiers, private logs, recordings, or generated agent memory.
- Keep project-specific private instructions outside this repository.
- Use pull requests for changes to `main`.
