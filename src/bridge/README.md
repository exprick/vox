# Bridge

The bridge is a local development service for Vox.

It:

- serves the Vox web app and bridge APIs
- validates Supabase-authenticated learners before creating OpenAI Realtime client secrets
- stores per-session browser recordings for debugging and teaching analysis
- queues commands for the iOS PollClient
- dispatches local tool calls

## Usage

Local web app smoke:

```
OPENAI_API_KEY=... VOX_AUTH_REQUIRED=0 node src/bridge/server.mjs
```

Auth-required loopback bridge smoke:

```
OPENAI_API_KEY=... VOX_AUTH_REQUIRED=1 VOX_ALLOW_LOCAL_BRIDGE_BYPASS=1 node src/bridge/server.mjs
```
