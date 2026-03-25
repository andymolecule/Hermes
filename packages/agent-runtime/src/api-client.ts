import {
  AGORA_ERROR_CODES,
  type AgentChallengesQuery,
  AgoraError,
  agentChallengeDetailResponseSchema,
  agentChallengeLeaderboardResponseSchema,
  agentChallengesListResponseSchema,
  apiErrorResponseSchema,
  challengeRegistrationRequestSchema,
  challengeRegistrationResponseSchema,
  challengeSolverStatusResponseSchema,
  indexerHealthResponseSchema,
  readApiClientRuntimeConfig,
  submissionCleanupRequestSchema,
  submissionCleanupResponseSchema,
  submissionIntentRequestSchema,
  submissionIntentResponseSchema,
  submissionPublicKeyResponseSchema,
  submissionRegistrationRequestSchema,
  submissionRegistrationResponseSchema,
  submissionStatusResponseSchema,
  submissionUploadResponseSchema,
  submissionWaitStatusResponseSchema,
  type TrustedChallengeSpecOutput,
} from "@agora/common";

function isAddressRef(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function resolveApiUrl(explicitApiUrl?: string) {
  const apiUrl = explicitApiUrl ?? readApiClientRuntimeConfig().apiUrl;
  if (!apiUrl) {
    throw new AgoraError("AGORA_API_URL is required for API requests.", {
      code: AGORA_ERROR_CODES.configMissing,
      nextAction: "Set AGORA_API_URL and retry.",
    });
  }
  return apiUrl.replace(/\/$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch failed|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT/i.test(
    message,
  );
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
  maxAttempts?: number;
}) {
  const maxAttempts = input.maxAttempts ?? 1;
  let lastRetryableError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
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
        const error = await toApiRequestError(response);
        if (error.retriable && attempt < maxAttempts) {
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }
      return input.parse(await response.json());
    } catch (error) {
      if (attempt < maxAttempts && isRetryableFetchError(error)) {
        lastRetryableError = error;
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      if (isRetryableFetchError(error)) {
        lastRetryableError = error;
        break;
      }
      throw error;
    }
  }

  throw new AgoraError("API request exhausted all retry attempts.", {
    code: AGORA_ERROR_CODES.apiRequestFailed,
    retriable: true,
    nextAction: "Retry in a few seconds or inspect the API service health.",
    cause: lastRetryableError ?? undefined,
    details: {
      pathname: input.pathname,
      maxAttempts,
      lastError:
        lastRetryableError instanceof Error
          ? lastRetryableError.message
          : lastRetryableError
            ? String(lastRetryableError)
            : null,
    },
  });
}

async function toApiRequestError(response: Response) {
  const payload = await response.json().catch(() => null);
  const parsedError = apiErrorResponseSchema.safeParse(payload);
  if (parsedError.success) {
    return new AgoraError(parsedError.data.error, {
      code: parsedError.data.code,
      retriable: parsedError.data.retriable,
      status: response.status,
      nextAction: parsedError.data.nextAction,
      details: parsedError.data.details,
    });
  }
  return new AgoraError(
    `API request failed (${response.status}). Next step: retry or inspect the API response body.`,
    {
      code: AGORA_ERROR_CODES.apiRequestFailed,
      retriable: response.status >= 500,
      status: response.status,
    },
  );
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
    maxAttempts: 3,
  });
}

export async function getChallengeFromApi(
  challengeIdOrAddress: string,
  apiUrl?: string,
) {
  const pathname = isAddressRef(challengeIdOrAddress)
    ? `/api/challenges/by-address/${challengeIdOrAddress}`
    : `/api/challenges/${challengeIdOrAddress}`;
  return requestJson({
    apiUrl,
    pathname,
    parse: (json) => agentChallengeDetailResponseSchema.parse(json),
    maxAttempts: 3,
  });
}

export async function registerChallengeWithApi(
  input: {
    txHash: `0x${string}`;
    trustedSpec?: TrustedChallengeSpecOutput;
  },
  apiUrl?: string,
) {
  const payload = challengeRegistrationRequestSchema.parse({
    txHash: input.txHash,
    trusted_spec: input.trustedSpec,
  });
  const response = await requestJson({
    apiUrl,
    pathname: "/api/challenges",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => challengeRegistrationResponseSchema.parse(json),
    maxAttempts: 3,
  });
  return response.data;
}

export async function getIndexerHealthFromApi(apiUrl?: string) {
  return requestJson({
    apiUrl,
    pathname: "/api/indexer-health",
    parse: (json) => indexerHealthResponseSchema.parse(json),
    maxAttempts: 3,
  });
}

export async function getChallengeLeaderboardFromApi(
  challengeIdOrAddress: string,
  apiUrl?: string,
) {
  const pathname = isAddressRef(challengeIdOrAddress)
    ? `/api/challenges/by-address/${challengeIdOrAddress}/leaderboard`
    : `/api/challenges/${challengeIdOrAddress}/leaderboard`;
  return requestJson({
    apiUrl,
    pathname,
    parse: (json) => agentChallengeLeaderboardResponseSchema.parse(json),
    maxAttempts: 3,
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
    maxAttempts: 3,
  });
}

export async function waitForSubmissionStatusFromApi(
  submissionId: string,
  input?: {
    timeoutSeconds?: number;
  },
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: appendQuery(`/api/submissions/${submissionId}/wait`, {
      timeout_seconds: input?.timeoutSeconds,
    }),
    parse: (json) => submissionWaitStatusResponseSchema.parse(json),
    maxAttempts: 1,
  });
}

export async function getSubmissionStatusByOnChainFromApi(
  input: {
    challengeAddress: string;
    onChainSubmissionId: number;
  },
  apiUrl?: string,
) {
  return requestJson({
    apiUrl,
    pathname: `/api/submissions/by-onchain/${input.challengeAddress}/${input.onChainSubmissionId}/status`,
    parse: (json) => submissionStatusResponseSchema.parse(json),
    maxAttempts: 3,
  });
}

export async function getSubmissionPublicKeyFromApi(apiUrl?: string) {
  return requestJson({
    apiUrl,
    pathname: "/api/submissions/public-key",
    parse: (json) => submissionPublicKeyResponseSchema.parse(json),
    maxAttempts: 3,
  });
}

export async function uploadSubmissionArtifactToApi(
  input: {
    bytes: Uint8Array;
    fileName?: string;
    contentType?: string;
  },
  apiUrl?: string,
) {
  const response = await fetch(
    `${resolveApiUrl(apiUrl)}/api/submissions/upload`,
    {
      method: "POST",
      headers: {
        ...(input.contentType ? { "content-type": input.contentType } : {}),
        ...(input.fileName ? { "x-file-name": input.fileName } : {}),
      },
      body: input.bytes,
    },
  );
  if (!response.ok) {
    throw await toApiRequestError(response);
  }
  return submissionUploadResponseSchema.parse(await response.json()).data;
}

export async function createSubmissionIntentWithApi(
  input: {
    challengeId?: string;
    challengeAddress?: `0x${string}`;
    solverAddress: `0x${string}`;
    submissionCid: string;
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
    maxAttempts: 3,
  });
  return response.data;
}

export async function registerSubmissionWithApi(
  input: {
    challengeId?: string;
    challengeAddress?: `0x${string}`;
    intentId: string;
    submissionCid: string;
    txHash: `0x${string}`;
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
    maxAttempts: 3,
  });
}

export async function cleanupSubmissionArtifactWithApi(
  input: {
    submissionCid: string;
    intentId?: string;
  },
  apiUrl?: string,
) {
  const payload = submissionCleanupRequestSchema.parse(input);
  const response = await requestJson({
    apiUrl,
    pathname: "/api/submissions/cleanup",
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    parse: (json) => submissionCleanupResponseSchema.parse(json),
    maxAttempts: 3,
  });
  return response.data;
}

export async function getChallengeSolverStatusFromApi(
  challengeIdOrAddress: string,
  solverAddress: string,
  apiUrl?: string,
) {
  const pathname = isAddressRef(challengeIdOrAddress)
    ? `/api/challenges/by-address/${challengeIdOrAddress}/solver-status`
    : `/api/challenges/${challengeIdOrAddress}/solver-status`;
  return requestJson({
    apiUrl,
    pathname: appendQuery(pathname, { solver_address: solverAddress }),
    parse: (json) => challengeSolverStatusResponseSchema.parse(json),
    maxAttempts: 3,
  });
}
