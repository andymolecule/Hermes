import { getPublicClient } from "@hermes/chain";
import { getHermesRuntimeIdentity, loadConfig } from "@hermes/common";
import { createSupabaseClient } from "@hermes/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const WARN_LAG_BLOCKS = Number(process.env.HERMES_INDEXER_LAG_WARN_BLOCKS ?? 20);
const CRITICAL_LAG_BLOCKS = Number(
  process.env.HERMES_INDEXER_LAG_CRITICAL_BLOCKS ?? 120,
);
const INDEXER_CONFIRMATION_DEPTH = (() => {
  const parsed = Number(process.env.HERMES_INDEXER_CONFIRMATION_DEPTH ?? 3);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
})();
const ACTIVE_FACTORY_CURSOR_WINDOW_MS = Number(
  process.env.HERMES_INDEXER_ACTIVE_CURSOR_WINDOW_MS ?? 15 * 60 * 1000,
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
    const runtimeIdentity = getHermesRuntimeIdentity(config);
    const db = createSupabaseClient(true);
    const publicClient = getPublicClient();

    // Build the cursor key the indexer uses
    const factoryAddress = runtimeIdentity.factoryAddress.toLowerCase();
    const chainId = runtimeIdentity.chainId;
    const cursorKey = `factory:${chainId}:${factoryAddress}`;
    const factoryCursorPrefix = `factory:${chainId}:`;

    // Source of truth: read from indexer_cursors only.
    const [
      { data: cursorRow, error: cursorError },
      { data: factoryCursorRows, error: factoryCursorError },
      chainHead,
    ] =
      await Promise.all([
        db
          .from("indexer_cursors")
          .select("block_number")
          .eq("cursor_key", cursorKey)
          .maybeSingle(),
        db
          .from("indexer_cursors")
          .select("cursor_key, block_number, updated_at")
          .like("cursor_key", `${factoryCursorPrefix}%`)
          .order("updated_at", { ascending: false }),
        publicClient.getBlockNumber(),
      ]);

    if (cursorError) {
      throw new Error(
        `Failed to read indexer cursor: ${cursorError.message}`,
      );
    }
    if (factoryCursorError) {
      throw new Error(
        `Failed to read factory cursors: ${factoryCursorError.message}`,
      );
    }

    const indexedHead = cursorRow?.block_number
      ? Number(cursorRow.block_number)
      : null;
    const chainHeadNumber = Number(chainHead);
    const finalizedHead = Math.max(
      chainHeadNumber - INDEXER_CONFIRMATION_DEPTH,
      0,
    );
    const lagBlocks =
      indexedHead === null
        ? finalizedHead
        : Math.max(finalizedHead - Number(indexedHead), 0);
    const nowMs = Date.now();
    const activeAlternateFactories = (factoryCursorRows ?? [])
      .filter((row) => row.cursor_key !== cursorKey)
      .map((row) => {
        const parts = row.cursor_key.split(":");
        return {
          factoryAddress: parts[2] ?? row.cursor_key,
          blockNumber: Number(row.block_number ?? 0),
          updatedAt: String(row.updated_at ?? ""),
        };
      })
      .filter((row) => {
        const updatedAtMs = Date.parse(row.updatedAt);
        return (
          Number.isFinite(updatedAtMs) &&
          nowMs - updatedAtMs <= ACTIVE_FACTORY_CURSOR_WINDOW_MS
        );
      });
    const hasAlternateActiveFactory = activeAlternateFactories.length > 0;
    const mismatchMessage = hasAlternateActiveFactory
      ? "Configured factory cursor is not the only active factory cursor on this chain. Check deployment env alignment."
      : null;
    let status = toLagStatus(lagBlocks, indexedHead !== null);
    if (status === "ok" && hasAlternateActiveFactory) {
      status = "warning";
    }

    const body = {
      ok: status === "ok" || status === "warning" || status === "empty",
      status,
      chainHead: chainHeadNumber,
      finalizedHead,
      indexedHead,
      lagBlocks,
      confirmationDepth: INDEXER_CONFIRMATION_DEPTH,
      configured: {
        chainId: runtimeIdentity.chainId,
        factoryAddress: runtimeIdentity.factoryAddress,
        usdcAddress: runtimeIdentity.usdcAddress,
      },
      activeAlternateFactories,
      mismatch: {
        hasAlternateActiveFactory,
        message: mismatchMessage,
      },
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
