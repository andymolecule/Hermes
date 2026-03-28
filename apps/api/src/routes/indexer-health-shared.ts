import { getPublicClient } from "@agora/chain";
import {
  buildFactoryCursorKey,
  buildFactoryHighWaterCursorKey,
  getAgoraReleaseMetadata,
  getAgoraRuntimeIdentity,
  loadConfig,
  readIndexerHealthRuntimeConfig,
} from "@agora/common";
import { countUnmatchedSubmissions, createSupabaseClient } from "@agora/db";

export type IndexerLagStatus =
  | "ok"
  | "warning"
  | "critical"
  | "empty"
  | "error";

export interface IndexerHealthSnapshot {
  ok: boolean;
  service: "indexer";
  status: IndexerLagStatus;
  releaseId: string;
  gitSha: string | null;
  runtimeVersion: string;
  identitySource: string;
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
  unmatchedSubmissions: {
    total: number;
    stale: number;
    staleThresholdMinutes: number;
  };
  thresholds: {
    warning: number;
    critical: number;
  };
  checkedAt: string;
}

type IndexerCursorRow = {
  cursor_key: string;
  block_number: number | string | null;
  updated_at: string | null;
};

export function toLagStatus(
  lagBlocks: number,
  hasIndexedBlock: boolean,
): IndexerLagStatus {
  const runtimeConfig = readIndexerHealthRuntimeConfig();
  if (!hasIndexedBlock) return "empty";
  if (lagBlocks >= runtimeConfig.criticalLagBlocks) return "critical";
  if (lagBlocks >= runtimeConfig.warningLagBlocks) return "warning";
  return "ok";
}

export function resolveIndexedHead(input: {
  replayCursorBlock: number | null;
  highWaterCursorBlock: number | null;
}): number | null {
  return input.highWaterCursorBlock ?? input.replayCursorBlock;
}

export function buildIndexerHealthSnapshot(input: {
  runtimeIdentity: {
    chainId: number;
    factoryAddress: string;
    usdcAddress: string;
  };
  release: {
    releaseId: string;
    gitSha: string | null;
    runtimeVersion: string;
    identitySource: string;
  };
  healthConfig: {
    confirmationDepth: number;
    warningLagBlocks: number;
    criticalLagBlocks: number;
    activeCursorWindowMs: number;
  };
  chainHead: number;
  indexedHead: number | null;
  configuredCursorKey: string;
  factoryCursorRows: IndexerCursorRow[];
  unmatchedSubmissions?: {
    total: number;
    stale: number;
    staleThresholdMinutes: number;
  };
  nowMs?: number;
}): IndexerHealthSnapshot {
  const finalizedHead = Math.max(
    input.chainHead - input.healthConfig.confirmationDepth,
    0,
  );
  const lagBlocks =
    input.indexedHead === null
      ? finalizedHead
      : Math.max(finalizedHead - input.indexedHead, 0);
  const nowMs = input.nowMs ?? Date.now();
  const activeAlternateFactories = input.factoryCursorRows
    .filter((row) => row.cursor_key !== input.configuredCursorKey)
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
        nowMs - updatedAtMs <= input.healthConfig.activeCursorWindowMs
      );
    });
  const hasAlternateActiveFactory = activeAlternateFactories.length > 0;
  const mismatchMessage = hasAlternateActiveFactory
    ? "Configured factory cursor is not the only active factory cursor on this chain. Check deployment env alignment."
    : null;
  let status = toLagStatus(lagBlocks, input.indexedHead !== null);
  if (
    (status === "ok" || status === "empty") &&
    (hasAlternateActiveFactory || (input.unmatchedSubmissions?.stale ?? 0) > 0)
  ) {
    status = "warning";
  }

  return {
    ok: status === "ok" || status === "warning" || status === "empty",
    service: "indexer",
    status,
    releaseId: input.release.releaseId,
    gitSha: input.release.gitSha,
    runtimeVersion: input.release.runtimeVersion,
    identitySource: input.release.identitySource,
    chainHead: input.chainHead,
    finalizedHead,
    indexedHead: input.indexedHead,
    lagBlocks,
    confirmationDepth: input.healthConfig.confirmationDepth,
    configured: {
      chainId: input.runtimeIdentity.chainId,
      factoryAddress: input.runtimeIdentity.factoryAddress,
      usdcAddress: input.runtimeIdentity.usdcAddress,
    },
    activeAlternateFactories,
    mismatch: {
      hasAlternateActiveFactory,
      message: mismatchMessage,
    },
    unmatchedSubmissions: input.unmatchedSubmissions ?? {
      total: 0,
      stale: 0,
      staleThresholdMinutes: 5,
    },
    thresholds: {
      warning: input.healthConfig.warningLagBlocks,
      critical: input.healthConfig.criticalLagBlocks,
    },
    checkedAt: new Date().toISOString(),
  };
}

export async function readIndexerHealthSnapshot(): Promise<IndexerHealthSnapshot> {
  const config = loadConfig();
  const runtimeIdentity = getAgoraRuntimeIdentity(config);
  const release = getAgoraReleaseMetadata(config);
  const healthConfig = readIndexerHealthRuntimeConfig();
  const db = createSupabaseClient(true);
  const publicClient = getPublicClient();

  const factoryAddress = runtimeIdentity.factoryAddress;
  const chainId = runtimeIdentity.chainId;
  const cursorKey = buildFactoryCursorKey(chainId, factoryAddress);
  const highWaterCursorKey = buildFactoryHighWaterCursorKey(
    chainId,
    factoryAddress,
  );
  const factoryCursorPrefix = `factory:${chainId}:`;
  const staleThresholdMinutes = 5;
  const staleOlderThanIso = new Date(
    Date.now() - staleThresholdMinutes * 60_000,
  ).toISOString();

  const [
    { data: cursorRow, error: cursorError },
    { data: highWaterCursorRow, error: highWaterCursorError },
    { data: factoryCursorRows, error: factoryCursorError },
    unmatchedTotal,
    unmatchedStale,
    chainHead,
  ] = await Promise.all([
    db
      .from("indexer_cursors")
      .select("block_number")
      .eq("cursor_key", cursorKey)
      .maybeSingle(),
    db
      .from("indexer_cursors")
      .select("block_number")
      .eq("cursor_key", highWaterCursorKey)
      .maybeSingle(),
    db
      .from("indexer_cursors")
      .select("cursor_key, block_number, updated_at")
      .like("cursor_key", `${factoryCursorPrefix}%`)
      .order("updated_at", { ascending: false }),
    countUnmatchedSubmissions(db),
    countUnmatchedSubmissions(db, {
      olderThanIso: staleOlderThanIso,
    }),
    publicClient.getBlockNumber(),
  ]);

  if (cursorError) {
    throw new Error(`Failed to read indexer cursor: ${cursorError.message}`);
  }
  if (highWaterCursorError) {
    throw new Error(
      `Failed to read indexer high-water cursor: ${highWaterCursorError.message}`,
    );
  }
  if (factoryCursorError) {
    throw new Error(
      `Failed to read factory cursors: ${factoryCursorError.message}`,
    );
  }

  const replayCursorBlock = cursorRow?.block_number
    ? Number(cursorRow.block_number)
    : null;
  const highWaterCursorBlock = highWaterCursorRow?.block_number
    ? Number(highWaterCursorRow.block_number)
    : null;

  return buildIndexerHealthSnapshot({
    runtimeIdentity,
    release,
    healthConfig,
    chainHead: Number(chainHead),
    indexedHead: resolveIndexedHead({
      replayCursorBlock,
      highWaterCursorBlock,
    }),
    configuredCursorKey: cursorKey,
    factoryCursorRows: (factoryCursorRows ?? []) as IndexerCursorRow[],
    unmatchedSubmissions: {
      total: unmatchedTotal,
      stale: unmatchedStale,
      staleThresholdMinutes,
    },
  });
}
