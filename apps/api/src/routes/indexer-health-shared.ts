import { getPublicClient } from "@agora/chain";
import { getAgoraRuntimeIdentity, loadConfig } from "@agora/common";
import { createSupabaseClient } from "@agora/db";

export const WARN_LAG_BLOCKS = Number(
  process.env.AGORA_INDEXER_LAG_WARN_BLOCKS ?? 20,
);
export const CRITICAL_LAG_BLOCKS = Number(
  process.env.AGORA_INDEXER_LAG_CRITICAL_BLOCKS ?? 120,
);
export const INDEXER_CONFIRMATION_DEPTH = (() => {
  const parsed = Number(process.env.AGORA_INDEXER_CONFIRMATION_DEPTH ?? 3);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
})();
const ACTIVE_FACTORY_CURSOR_WINDOW_MS = Number(
  process.env.AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS ?? 15 * 60 * 1000,
);

export type IndexerLagStatus =
  | "ok"
  | "warning"
  | "critical"
  | "empty"
  | "error";

export interface IndexerHealthSnapshot {
  ok: boolean;
  status: IndexerLagStatus;
  chainHead: number;
  finalizedHead: number;
  indexedHead: number | null;
  lagBlocks: number;
  confirmationDepth: number;
  configured: {
    chainId: number;
    factoryAddress: string;
    usdcAddress: string;
  };
  activeAlternateFactories: Array<{
    factoryAddress: string;
    blockNumber: number;
    updatedAt: string;
  }>;
  mismatch: {
    hasAlternateActiveFactory: boolean;
    message: string | null;
  };
  thresholds: {
    warning: number;
    critical: number;
  };
  checkedAt: string;
}

export function toLagStatus(
  lagBlocks: number,
  hasIndexedBlock: boolean,
): IndexerLagStatus {
  if (!hasIndexedBlock) return "empty";
  if (lagBlocks >= CRITICAL_LAG_BLOCKS) return "critical";
  if (lagBlocks >= WARN_LAG_BLOCKS) return "warning";
  return "ok";
}

export async function readIndexerHealthSnapshot(): Promise<IndexerHealthSnapshot> {
  const config = loadConfig();
  const runtimeIdentity = getAgoraRuntimeIdentity(config);
  const db = createSupabaseClient(true);
  const publicClient = getPublicClient();

  const factoryAddress = runtimeIdentity.factoryAddress.toLowerCase();
  const chainId = runtimeIdentity.chainId;
  const cursorKey = `factory:${chainId}:${factoryAddress}`;
  const factoryCursorPrefix = `factory:${chainId}:`;

  const [
    { data: cursorRow, error: cursorError },
    { data: factoryCursorRows, error: factoryCursorError },
    chainHead,
  ] = await Promise.all([
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
    throw new Error(`Failed to read indexer cursor: ${cursorError.message}`);
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

  return {
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
}
