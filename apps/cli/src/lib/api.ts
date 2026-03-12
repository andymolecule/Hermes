import {
  type AgentChallengesQuery,
  getChallengeFromApi,
  listChallengesFromApi,
} from "@agora/agent-runtime";
import { readApiClientRuntimeConfig } from "@agora/common";

function requireApiUrl() {
  const apiUrl = readApiClientRuntimeConfig().apiUrl;
  if (!apiUrl) {
    throw new Error(
      "AGORA_API_URL is required for API requests. Next step: set AGORA_API_URL and retry.",
    );
  }
  return apiUrl;
}

export async function fetchApiJson<T>(pathname: string): Promise<T> {
  const apiUrl = requireApiUrl();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${normalizedPath}`);
  if (!response.ok) {
    throw new Error(
      `API request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

export async function listChallengesApi(query: AgentChallengesQuery) {
  return listChallengesFromApi(query, requireApiUrl());
}

export async function getChallengeApi(challengeId: string) {
  return getChallengeFromApi(challengeId, requireApiUrl());
}
