# AGENTS.md

This repository is public-safe. Treat all committed files as potentially visible to external contributors.

## Project

Vox is a local-first voice English tutor prototype:

- iOS SwiftUI app: native Vox Voice surface matching the web app
- Node bridge: OpenAI Realtime session minting, command queue, local tools

## Development Rules

- Do not commit secrets, local credentials, personal memory, private logs, recordings, or device-specific IDs.
- Keep bridge URLs, device IDs, signing teams, and API keys configurable through environment variables or local Xcode settings.
- Use small PRs and keep user-visible behavior changes explicit.
- For UI changes, verify in a browser or simulator before claiming done.

## Useful Commands

```bash
npm install
OPENAI_API_KEY=... node src/bridge/server.mjs
cd ios && xcodegen generate
```
