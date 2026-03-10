import { Hono } from "hono";
import type { ApiEnv } from "../types.js";
import { readIndexerHealthSnapshot } from "./indexer-health-shared.js";

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const body = await readIndexerHealthSnapshot();
    const httpStatus = body.status === "critical" ? 503 : 200;
    return c.json(body, httpStatus);
  } catch (error) {
    return c.json(
      {
        ok: false,
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to read indexer lag",
        checkedAt: new Date().toISOString(),
      },
      503,
    );
  }
});

export default router;
