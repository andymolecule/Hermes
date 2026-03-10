import { isScorerInfrastructureError } from "@agora/scorer";

export const POLL_INTERVAL_MS = Number(process.env.AGORA_WORKER_POLL_MS ?? 15_000);
export const FINALIZE_SWEEP_INTERVAL_MS = Number(
  process.env.AGORA_WORKER_FINALIZE_SWEEP_MS ?? 60_000,
);
export const POST_TX_RETRY_DELAY_MS = Number(
  process.env.AGORA_WORKER_POST_TX_RETRY_MS ?? 30_000,
);
export const INFRA_RETRY_DELAY_MS = Number(
  process.env.AGORA_WORKER_INFRA_RETRY_MS ?? 5 * 60 * 1000,
);

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function isWorkerInfrastructureError(message: string): boolean {
  return isScorerInfrastructureError(message);
}
