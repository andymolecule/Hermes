import { API_BASE_URL } from "./config";
import type { AnalyticsData, Challenge, ChallengeDetails, SolverPortfolio, Stats, WorkerHealth } from "./types";

const BASE = API_BASE_URL.replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as { data?: T };
  return json.data as T;
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
  return request<ChallengeDetails>(`/api/challenges/${id}`);
}

export async function accelerateChallengeIndex(input: {
  txHash: `0x${string}`;
}) {
  return request<{ ok: boolean; challengeAddress: string }>("/api/challenges", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getSolverPortfolio(address: string): Promise<SolverPortfolio> {
  return request<SolverPortfolio>(`/api/solver/${address}`);
}

export async function createSubmissionRecord(input: {
  challengeId: string;
  resultCid: string;
  txHash: `0x${string}`;
  resultFormat?: "plain_v0" | "sealed_v1";
}) {
  const response = await fetch(`${BASE}/api/submissions`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as {
    ok: boolean;
    submission?: { id: string };
  };
}

export async function getSubmissionPublicKey() {
  return request<{
    version: "sealed_submission_v1";
    alg: "aes-256-gcm+rsa-oaep-256";
    kid: string;
    publicKeyPem: string;
  }>("/api/submissions/public-key");
}
