import type { ChallengeStatus } from "@agora/common";
import type { createSupabaseClient } from "@agora/db";
import { decodeChallengeStatusValue } from "../challenge.js";
import type { getPublicClient } from "../client.js";

export type DbClient = ReturnType<typeof createSupabaseClient>;
export type PublicClient = ReturnType<typeof getPublicClient>;

export interface ParsedLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  blockHash?: `0x${string}` | null;
}

export interface ChallengeListRow {
  id: string;
  contract_address: string;
  factory_address?: string | null;
  tx_hash: string;
  status: string;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export interface ChallengeLogProcessingResult {
  needsRepair: boolean;
}

export function eventArg(args: unknown, indexOrName: number | string): unknown {
  if (Array.isArray(args)) return args[indexOrName as number];
  if (args && typeof args === "object") {
    return (args as Record<string, unknown>)[indexOrName as string];
  }
  return undefined;
}

export function parseRequiredBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  throw new Error(`Invalid event arg '${field}': expected bigint`);
}

export function parseRequiredInteger(value: unknown, field: string): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new Error(`Invalid event arg '${field}': expected integer`);
}

export function parseRequiredAddress(
  value: unknown,
  field: string,
): `0x${string}` {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  throw new Error(`Invalid event arg '${field}': expected address string`);
}

export function parseStatusValue(
  value: unknown,
  field: string,
): ChallengeStatus {
  if (typeof value === "bigint") {
    return decodeChallengeStatusValue(value);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return decodeChallengeStatusValue(value);
  }
  throw new Error(`Invalid event arg '${field}': expected challenge status`);
}
