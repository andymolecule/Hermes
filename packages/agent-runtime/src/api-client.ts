import {
  type AgentChallengesQuery,
  agentChallengeDetailResponseSchema,
  agentChallengeLeaderboardResponseSchema,
  agentChallengesListResponseSchema,
  loadConfig,
  submissionIntentRequestSchema,
  submissionIntentResponseSchema,
  submissionPublicKeyResponseSchema,
  submissionRegistrationRequestSchema,
  submissionRegistrationResponseSchema,
  submissionStatusResponseSchema,
} from "@agora/common";

function resolveApiUrl(explicitApiUrl?: string) {
  const apiUrl = explicitApiUrl ?? loadConfig().AGORA_API_URL;
  if (!apiUrl) {
    throw new Error(
      "AGORA_API_URL is required for API requests. Next step: set AGORA_API_URL and retry.",
    );
  }
  return apiUrl.replace(/\/$/, "");
}

function appendQuery(
  pathname: string,
  query?: Record<string, string | number | undefined | null>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
}

async function requestJson<T>(input: {
  apiUrl?: string;
  pathname: string;
  init?: RequestInit;
  parse: (json: unknown) => T;
}) {
  const response = await fetch(
    `${resolveApiUrl(input.apiUrl)}${input.pathname}`,
    {
      headers: {
        "content-type": "application/json",
        ...(input.init?.headers ?? {}),
      },
      ...input.init,
    },
  );
  if (!response.ok) {
    throw new Error(
      `API request failed (${response.status}): ${await response.text()}`,
    );
  }
  return input.parse(await response.json());
}

export async function listChallengesFromApi(
  query: AgentChallengesQuery,
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: appendQuery("/api/challenges", {
      status: query.status,
      domain: query.domain,
      poster_address: query.poster_address,
      limit: query.limit,
      min_reward: query.min_reward,
      updated_since: query.updated_since,
      cursor: query.cursor,
    }),
    parse: (json) => agentChallengesListResponseSchema.parse(json),
  });
}

export async function getChallengeFromApi(
  challengeId: string,
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: `/api/challenges/${challengeId}`,
    parse: (json) => agentChallengeDetailResponseSchema.parse(json),
  });
}

export async function getChallengeLeaderboardFromApi(
  challengeId: string,
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: `/api/challenges/${challengeId}/leaderboard`,
    parse: (json) => agentChallengeLeaderboardResponseSchema.parse(json),
  });
}

export async function getSubmissionStatusFromApi(
  submissionId: string,
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: `/api/submissions/${submissionId}/status`,
    parse: (json) => submissionStatusResponseSchema.parse(json),
  });
}

export async function getSubmissionPublicKeyFromApi(apiUrl?: string) {
  return requestJson({
    apiUrl,
    pathname: "/api/submissions/public-key",
    parse: (json) => submissionPublicKeyResponseSchema.parse(json),
  });
}

export async function createSubmissionIntentWithApi(
  input: {
    challengeId: string;
    solverAddress: `0x${string}`;
    resultCid: string;
    resultFormat?: "plain_v0" | "sealed_submission_v2";
  },
  apiUrl?: string,
) {
  const payload = submissionIntentRequestSchema.parse(input);
  const response = await requestJson({
    apiUrl,
    pathname: "/api/submissions/intent",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => submissionIntentResponseSchema.parse(json),
  });
  return response.data;
}

export async function registerSubmissionWithApi(
  input: {
    challengeId: string;
    resultCid: string;
    txHash: `0x${string}`;
    resultFormat: "sealed_submission_v2";
  },
  apiUrl?: string,
) {
  const payload = submissionRegistrationRequestSchema.parse(input);
  return requestJson({
    apiUrl,
    pathname: "/api/submissions",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => submissionRegistrationResponseSchema.parse(json),
  });
}
