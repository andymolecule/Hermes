import { API_BASE_URL } from "./config";
import type { Challenge, ChallengeDetails, Stats } from "./types";

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
  specCid: string;
  txHash: `0x${string}`;
}) {
  const response = await fetch(`${BASE}/api/challenges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as { ok: boolean; challengeAddress: string };
}
