#!/usr/bin/env node
import { dispatchArtifactCreate } from './dispatch.mjs';

const raw = await readStdin();

let spec;
try {
  spec = JSON.parse(raw);
} catch (e) {
  console.error(JSON.stringify({ error: `bad JSON on stdin: ${e.message}` }));
  process.exit(1);
}

const handlers = {
  'artifact.create': async () => {
    const result = await dispatchArtifactCreate(spec);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 2);
  },
};

const handler = handlers[spec.task];
if (!handler) {
  console.error(JSON.stringify({ error: `unsupported task: ${spec.task}` }));
  process.exit(1);
}
await handler();

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf-8');
}
