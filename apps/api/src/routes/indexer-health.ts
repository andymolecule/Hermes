import { getPublicClient } from "@hermes/chain";
import { loadConfig } from "@hermes/common";
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
    const config = loadConfig();
    const db = createSupabaseClient(true);
    const publicClient = getPublicClient();

    // Build the cursor key the indexer uses
    const factoryAddress = config.HERMES_FACTORY_ADDRESS.toLowerCase();
    const chainId = config.HERMES_CHAIN_ID ?? 84532;
    const cursorKey = `factory:${chainId}:${factoryAddress}`;

    // Source of truth: read from indexer_cursors only.
    const [{ data: cursorRow, error: cursorError }, chainHead] =
      await Promise.all([
        db
          .from("indexer_cursors")
          .select("block_number")
          .eq("cursor_key", cursorKey)
          .maybeSingle(),
        publicClient.getBlockNumber(),
      ]);

    if (cursorError) {
      throw new Error(
        `Failed to read indexer cursor: ${cursorError.message}`,
      );
    }

    const indexedHead = cursorRow?.block_number
      ? Number(cursorRow.block_number)
      : null;
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
