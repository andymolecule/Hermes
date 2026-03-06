import { serve } from "@hono/node-server";
import { loadConfig } from "@hermes/common";
import { createApp } from "./app.js";
import { readSubmissionSealHealth } from "./lib/submission-seal-health.js";

async function start() {
  loadConfig();
  const sealHealth = await readSubmissionSealHealth();
  if (sealHealth.enabled && sealHealth.selfCheck !== "ok") {
    throw new Error(
      `Submission sealing startup self-check failed for kid ${sealHealth.keyId}: ${sealHealth.error ?? "unknown error"}`,
    );
  }

  const port = Number(process.env.HERMES_API_PORT ?? 3000);
  const app = createApp();

  serve({ fetch: app.fetch, port });

  console.log(`Hermes API listening on http://localhost:${port}`);
}

start().catch((error) => {
  console.error(
    `Hermes API failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
