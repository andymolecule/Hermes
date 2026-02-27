import { getPublicClient } from "@hermes/chain";
import { createSupabaseClient } from "@hermes/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const WARN_LAG_BLOCKS = Number(process.env.HERMES_INDEXER_LAG_WARN_BLOCKS ?? 20);
const CRITICAL_LAG_BLOCKS = Number(
  process.env.HERMES_INDEXER_LAG_CRITICAL_BLOCKS ?? 120,
);

type LagStatus = "ok" | "warning" | "critical" | "empty" | "error";

function toLagStatus(lagBlocks: number, hasIndexedBlock: boolean): LagStatus {
  if (!hasIndexedBlock) return "empty";
  if (lagBlocks >= CRITICAL_LAG_BLOCKS) return "critical";
  if (lagBlocks >= WARN_LAG_BLOCKS) return "warning";
  return "ok";
}

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const db = createSupabaseClient(false);
    const publicClient = getPublicClient();

    const [{ data: latestIndexed, error: indexedError }, chainHead] =
      await Promise.all([
        db
          .from("indexed_events")
          .select("block_number")
          .order("block_number", { ascending: false })
          .limit(1)
          .maybeSingle(),
        publicClient.getBlockNumber(),
      ]);

    if (indexedError) {
      throw new Error(
        `Failed to read indexed head block: ${indexedError.message}`,
      );
    }

    const indexedHead = latestIndexed?.block_number ?? null;
    const chainHeadNumber = Number(chainHead);
    const lagBlocks =
      indexedHead === null
        ? chainHeadNumber
        : Math.max(chainHeadNumber - Number(indexedHead), 0);
    const status = toLagStatus(lagBlocks, indexedHead !== null);

    const body = {
      ok: status === "ok" || status === "warning" || status === "empty",
      status,
      chainHead: chainHeadNumber,
      indexedHead,
      lagBlocks,
      thresholds: {
        warning: WARN_LAG_BLOCKS,
        critical: CRITICAL_LAG_BLOCKS,
      },
      checkedAt: new Date().toISOString(),
    };

    const httpStatus = status === "critical" ? 503 : 200;
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
