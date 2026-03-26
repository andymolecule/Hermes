import {
  type ChallengeSpecOutput,
  DEFAULT_IPFS_GATEWAY,
  type SubmissionResultFormat,
  agentChallengeDetailResponseSchema,
  agentChallengesListResponseSchema,
  challengeRegistrationResponseSchema,
  challengeSpecSchema,
} from "@agora/common";
import { API_BASE_URL } from "./config";
import type {
  AnalyticsData,
  ApiHealth,
  AuthSession,
  ChallengeClaimableInfo,
  PublicLeaderboardEntry,
  SolverPortfolio,
  Stats,
  SubmissionVerification,
  WorkerHealth,
} from "./types";

const BASE = API_BASE_URL.replace(/\/$/, "");

export function resolveApiRequestUrl(path: string) {
  if (typeof window !== "undefined" && path.startsWith("/api/")) {
    return path;
  }
  return `${BASE}${path}`;
}

async function getApiErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown } | unknown;
    };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      "message" in parsed.error &&
      typeof (parsed.error as { message?: unknown }).message === "string"
    ) {
      return (parsed.error as { message: string }).message;
    }
  } catch {
    // Fall through to raw text.
  }
  return text || `Request failed (${response.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiRequestUrl(path), {
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

async function requestRaw<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveApiRequestUrl(path), {
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

  return (await response.json()) as T;
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
  return requestRaw<WorkerHealth>("/api/worker-health", {
    signal: AbortSignal.timeout(5000),
  });
}

export async function getApiHealth() {
  return requestRaw<ApiHealth>("/api/health");
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
  const response = await fetch(
    resolveApiRequestUrl(`/api/challenges${query ? `?${query}` : ""}`),
    {
      headers: { "content-type": "application/json" },
    },
  );
  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }
  const json = (await response.json()) as unknown;
  return agentChallengesListResponseSchema.parse(json).data;
}

export async function getChallenge(id: string) {
  const response = await fetch(resolveApiRequestUrl(`/api/challenges/${id}`), {
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }
  const json = (await response.json()) as unknown;
  return agentChallengeDetailResponseSchema.parse(json).data;
}

function isLegacySpecMissingSubmissionContract(raw: unknown): boolean {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      !("submission_contract" in (raw as Record<string, unknown>)),
  );
}

export function hydrateChallengeSpec(raw: unknown): ChallengeSpecOutput {
  const parsed = challengeSpecSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  if (isLegacySpecMissingSubmissionContract(raw)) {
    throw new Error(
      "Pinned challenge spec does not match the current Agora schema. Next step: use the remaining page metadata only, or post a new challenge with the current schema if you need the full spec.",
    );
  }

  throw parsed.error;
}

export async function getChallengeSpec(
  specCid: string,
): Promise<ChallengeSpecOutput> {
  const url = `${DEFAULT_IPFS_GATEWAY}${specCid.replace("ipfs://", "")}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch challenge spec (${response.status}).`);
  }
  const json = (await response.json()) as unknown;
  return hydrateChallengeSpec(json);
}

export async function accelerateChallengeIndex(input: {
  txHash: `0x${string}`;
}) {
  const response = await fetch(resolveApiRequestUrl("/api/challenges"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const message = await getApiErrorMessage(response);
    throw new Error(`API request failed (${response.status}): ${message}`);
  }
  const json = (await response.json()) as unknown;
  return challengeRegistrationResponseSchema.parse(json).data;
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
  intentId: string;
  resultCid: string;
  resultFormat: SubmissionResultFormat;
  txHash: `0x${string}`;
}) {
  return requestWithCredentials<{
    submission: { id: string };
    phase: "registration_confirmed";
    warning: { code: string; message: string } | null;
  }>("/api/submissions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createSubmissionIntent(input: {
  challengeId: string;
  solverAddress: `0x${string}`;
  resultCid: string;
  resultFormat: SubmissionResultFormat;
}) {
  return requestWithCredentials<{
    intentId: string;
    resultHash: `0x${string}`;
    expiresAt: string;
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

export async function getChallengeClaimableInfo(input: {
  challengeId: string;
  address?: string;
  refresh?: number;
}) {
  const params = new URLSearchParams();
  if (input.address) params.set("address", input.address);
  if (typeof input.refresh === "number" && input.refresh > 0) {
    params.set("refresh", String(input.refresh));
  }
  const query = params.toString();
  return request<ChallengeClaimableInfo>(
    `/api/challenges/${input.challengeId}/claimable${query ? `?${query}` : ""}`,
  );
}

export async function getAuthSession(): Promise<AuthSession> {
  return requestWithCredentials<AuthSession>("/api/auth/session");
}

export async function getAuthNonce(): Promise<string> {
  const json = await requestWithCredentials<{ nonce?: string }>(
    "/api/auth/nonce",
  );
  if (!json.nonce) {
    throw new Error("SIWE nonce response missing nonce.");
  }
  return json.nonce;
}

export async function verifySiweSession(input: {
  message: string;
  signature: `0x${string}`;
}) {
  return requestWithCredentials<{
    ok: boolean;
    address: string;
    expiresAt: string;
  }>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function logoutSiweSession() {
  return requestWithCredentials<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}
