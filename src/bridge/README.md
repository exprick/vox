# Bridge

The bridge is a local development service for Vox.

It:

- serves the Vox web app and bridge APIs
- validates Supabase-authenticated learners before creating OpenAI Realtime client secrets
- stores per-session browser recordings for debugging and teaching analysis
- serves generated drill artifacts
- queues commands for the iOS PollClient
- dispatches local tool calls

```
function_call event (JSON on stdin)
        │
        ▼
   dispatch.mjs
        │ spawn codex exec --full-auto -C <artifact_dir> ...
        ▼
   codex (现有 agent runtime)
        │ writes file(s) to <artifact_dir>
        ▼
   dispatch.mjs collects { artifact_id, files, elapsed_ms, exit_code }
        │
        ▼
   stdout (function_call_output JSON)
```

## Usage

```
echo '{"task":"artifact.create","artifact_type":"speaking_drill","topic":"ordering food","target_language":"en","fossils":["interested_about"]}' \
  | node src/bridge/cli.mjs
```

Local web app smoke:

```
OPENAI_API_KEY=... VOX_AUTH_REQUIRED=0 node src/bridge/server.mjs
```

Auth-required loopback bridge smoke:

```
OPENAI_API_KEY=... VOX_AUTH_REQUIRED=1 VOX_ALLOW_LOCAL_BRIDGE_BYPASS=1 node src/bridge/server.mjs
```
