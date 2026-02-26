import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.HERMES_API_PORT ?? 3000);
const app = createApp();

serve({ fetch: app.fetch, port });

console.log(`Hermes API listening on http://localhost:${port}`);
