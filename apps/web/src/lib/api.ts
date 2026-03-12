import {
  type ChallengeSpecOutput,
  DEFAULT_IPFS_GATEWAY,
  type SubmissionContractOutput,
  agentChallengeDetailResponseSchema,
  challengeSpecSchema,
  createCsvTableSubmissionContract,
  createOpaqueFileSubmissionContract,
  isOfficialContainer,
} from "@agora/common";
import { API_BASE_URL } from "./config";
import type {
  AnalyticsData,
  AuthSession,
  Challenge,
  ChallengeDetails,
  PublicLeaderboardEntry,
  SolverPortfolio,
  Stats,
  SubmissionVerification,
  WorkerHealth,
} from "./types";

const BASE = API_BASE_URL.replace(/\/$/, "");

async function getApiErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall through to raw text.
  }
  return text || `Request failed (${response.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }

  const json = (await response.json()) as { data?: T };
  return json.data as T;
}

async function requestWithCredentials<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return request<T>(path, {
    credentials: "include",
    ...init,
  });
}

export async function getStats(): Promise<Stats> {
  return request<Stats>("/api/stats");
}

export async function getAnalytics(): Promise<AnalyticsData> {
  return request<AnalyticsData>("/api/analytics");
}

export async function getWorkerHealth(): Promise<WorkerHealth> {
  const response = await fetch(`${BASE}/api/worker-health`, {
    signal: AbortSignal.timeout(5000),
  });
  return (await response.json()) as WorkerHealth;
}

export async function listChallenges(filters: {
  status?: string;
  domain?: string;
  minReward?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.minReward !== undefined) {
    params.set("min_reward", String(filters.minReward));
  }
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));

  const query = params.toString();
  return request<Challenge[]>(`/api/challenges${query ? `?${query}` : ""}`);
}

export async function getChallenge(id: string) {
  const response = await fetch(`${BASE}/api/challenges/${id}`, {
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }
  const json = (await response.json()) as unknown;
  return agentChallengeDetailResponseSchema.parse(json)
    .data as ChallengeDetails;
}

/**
 * Infer a default submission contract from the raw spec's own fields.
 * Used when a legacy IPFS spec was pinned before submission_contract existed.
 *
 * The challengeSpecSchema superRefine requires csv_table for any spec using
 * an official Agora scorer preset, so we must check the scoring container.
 */
function inferSubmissionContractFromSpec(
  raw: Record<string, unknown>,
): SubmissionContractOutput | null {
  const specType = typeof raw.type === "string" ? raw.type : undefined;
  if (!specType) return null;

  // Check if this spec uses an official scorer — if so, schema mandates csv_table
  const scoring = raw.scoring as { container?: string } | undefined;
  const container = typeof scoring?.container === "string" ? scoring.container : "";
  const usesOfficialScorer = container.length > 0 && isOfficialContainer(container);

  // Official scorers always require csv_table contracts
  if (usesOfficialScorer) {
    // Docking has a known column schema
    if (specType === "docking") {
      return createCsvTableSubmissionContract({
        requiredColumns: ["ligand_id", "docking_score"],
        idColumn: "ligand_id",
        valueColumn: "docking_score",
      });
    }
    // Prediction has a known generic schema
    if (specType === "prediction") {
      return createCsvTableSubmissionContract({
        requiredColumns: ["id", "prediction"],
        idColumn: "id",
        valueColumn: "prediction",
      });
    }
    // All other official-preset types (reproducibility, etc.) get a generic CSV
    return createCsvTableSubmissionContract({
      requiredColumns: ["id", "value"],
    });
  }

  // Custom/opaque file types — no column structure needed
  if (
    specType === "optimization" ||
    specType === "red_team" ||
    specType === "custom"
  ) {
    return createOpaqueFileSubmissionContract();
  }

  // Unknown type with non-official scorer — safe opaque fallback
  return createOpaqueFileSubmissionContract();
}

export function hydrateChallengeSpec(
  raw: unknown,
  fallbackSubmissionContract?: SubmissionContractOutput | null,
): ChallengeSpecOutput {
  const parsed = challengeSpecSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  // Only attempt repair when submission_contract is missing from the raw spec
  if (raw && typeof raw === "object" && !("submission_contract" in raw)) {
    // Prefer caller-provided fallback (from DB expected_columns), then infer
    const contract =
      fallbackSubmissionContract ??
      inferSubmissionContractFromSpec(raw as Record<string, unknown>);

    if (contract) {
      const reparsed = challengeSpecSchema.safeParse({
        ...raw,
        submission_contract: contract,
      });
      if (reparsed.success) {
        return reparsed.data;
      }
    }
  }

  throw parsed.error;
}

export async function getChallengeSpec(
  specCid: string,
  fallbackSubmissionContract?: SubmissionContractOutput | null,
): Promise<ChallengeSpecOutput> {
  const url = `${DEFAULT_IPFS_GATEWAY}${specCid.replace("ipfs://", "")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch challenge spec (${response.status}).`);
  }
  const json = (await response.json()) as unknown;
  return hydrateChallengeSpec(json, fallbackSubmissionContract);
}

export async function accelerateChallengeIndex(input: {
  txHash: `0x${string}`;
}) {
  return request<{ ok: boolean; challengeAddress: string }>("/api/challenges", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMyPortfolio(): Promise<SolverPortfolio> {
  return requestWithCredentials<SolverPortfolio>("/api/me/portfolio");
}

export async function getPublicLeaderboard(): Promise<
  PublicLeaderboardEntry[]
> {
  return request<PublicLeaderboardEntry[]>("/api/leaderboard");
}

export async function createSubmissionRecord(input: {
  challengeId: string;
  resultCid: string;
  txHash: `0x${string}`;
  resultFormat?: "plain_v0" | "sealed_submission_v2";
}) {
  const response = await fetch(`${BASE}/api/submissions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }

  return (await response.json()) as {
    ok: boolean;
    submission?: { id: string };
  };
}

export async function createSubmissionIntent(input: {
  challengeId: string;
  solverAddress: `0x${string}`;
  resultCid: string;
  resultFormat?: "plain_v0" | "sealed_submission_v2";
}) {
  return requestWithCredentials<{
    intentId: string;
    resultHash: `0x${string}`;
    expiresAt: string;
    matchedSubmissionId: string | null;
  }>("/api/submissions/intent", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSubmissionPublicKey() {
  return request<{
    version: "sealed_submission_v2";
    alg: "aes-256-gcm+rsa-oaep-256";
    kid: string;
    publicKeyPem: string;
  }>("/api/submissions/public-key");
}

export async function getPublicSubmissionVerification(
  submissionId: string,
): Promise<SubmissionVerification> {
  return request<SubmissionVerification>(
    `/api/submissions/${submissionId}/public`,
  );
}

export async function getAuthSession(): Promise<AuthSession> {
  const response = await fetch(`${BASE}/api/auth/session`, {
    credentials: "include",
  });
  return (await response.json()) as AuthSession;
}

export async function getAuthNonce(): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/nonce`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch SIWE nonce (${response.status}).`);
  }
  const json = (await response.json()) as { nonce?: string };
  if (!json.nonce) {
    throw new Error("SIWE nonce response missing nonce.");
  }
  return json.nonce;
}

export async function verifySiweSession(input: {
  message: string;
  signature: `0x${string}`;
}) {
  const response = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(
      `SIWE verification failed (${response.status}): ${message}`,
    );
  }
  return (await response.json()) as {
    ok: boolean;
    address: string;
    expiresAt: string;
  };
}

export async function logoutSiweSession() {
  const response = await fetch(`${BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to clear session (${response.status}).`);
  }
  return (await response.json()) as { ok: boolean };
}
