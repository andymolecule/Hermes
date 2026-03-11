import { getAgoraRuntimeIdentity, loadConfig } from "@agora/common";
import { assertRuntimeDatabaseSchema, createSupabaseClient } from "@agora/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

async function start() {
  const config = loadConfig();
  const port = Number(process.env.AGORA_API_PORT ?? 3000);
  await assertRuntimeDatabaseSchema(createSupabaseClient(true));
  const app = createApp();
  const runtimeIdentity = getAgoraRuntimeIdentity(config);

  serve({ fetch: app.fetch, port });

  console.log("Agora API runtime identity", runtimeIdentity);
  console.log(`Agora API listening on http://localhost:${port}`);
}

start().catch((error) => {
  console.error(
    `Agora API failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
