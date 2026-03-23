import {
  type AgentChallengesQuery,
  getChallengeFromApi,
  getChallengeSolverStatusFromApi,
  getSubmissionStatusFromApi,
  listChallengesFromApi,
  waitForSubmissionStatusFromApi,
} from "@agora/agent-runtime";
import {
  AGORA_ERROR_CODES,
  AgoraError,
  apiErrorResponseSchema,
  authoringSessionTimelineSchema,
  readApiClientRuntimeConfig,
} from "@agora/common";

export type SubmissionStatusStreamEvent =
  | {
      event: "status" | "terminal";
      data: unknown;
    }
  | {
      event: "keepalive";
      data: unknown;
    }
  | {
      event: "error";
      data: unknown;
    };

function requireApiUrl() {
  const apiUrl = readApiClientRuntimeConfig().apiUrl;
  if (!apiUrl) {
    throw new AgoraError("AGORA_API_URL is required for API requests.", {
      code: AGORA_ERROR_CODES.configMissing,
      nextAction: "Set AGORA_API_URL and retry.",
    });
  }
  return apiUrl;
}

async function toApiRequestError(response: Response) {
  const payload = await response.json().catch(() => null);
  const parsed = apiErrorResponseSchema.safeParse(payload);
  if (parsed.success) {
    return new AgoraError(parsed.data.error, {
      code: parsed.data.code,
      retriable: parsed.data.retriable,
      status: response.status,
      nextAction: parsed.data.nextAction,
      details: parsed.data.details,
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

function parseSseRecord(record: string): SubmissionStatusStreamEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of record.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      eventName = value;
      continue;
    }
    if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  if (
    eventName !== "status" &&
    eventName !== "terminal" &&
    eventName !== "keepalive" &&
    eventName !== "error"
  ) {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join("\n"));
  } catch (error) {
    throw new AgoraError("Submission event stream sent invalid JSON data.", {
      code: AGORA_ERROR_CODES.apiRequestFailed,
      retriable: true,
      nextAction:
        "Retry in a few seconds or inspect the API stream response format.",
      cause: error,
    });
  }

  return {
    event: eventName,
    data,
  } as SubmissionStatusStreamEvent;
}

export async function fetchApiJson<T>(pathname: string): Promise<T> {
  const apiUrl = requireApiUrl();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${normalizedPath}`);
  if (!response.ok) {
    throw await toApiRequestError(response);
  }

  return (await response.json()) as T;
}

export async function fetchOperatorApiJson<T>(
  pathname: string,
  input: {
    token: string;
  },
): Promise<T> {
  const apiUrl = requireApiUrl();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}${normalizedPath}`, {
    headers: {
      authorization: `Bearer ${input.token}`,
    },
  });
  if (!response.ok) {
    throw await toApiRequestError(response);
  }

  return (await response.json()) as T;
}

export async function listChallengesApi(query: AgentChallengesQuery) {
  return listChallengesFromApi(query, requireApiUrl());
}

export async function getChallengeApi(challengeId: string) {
  return getChallengeFromApi(challengeId, requireApiUrl());
}

export async function getChallengeSolverStatusApi(
  challengeId: string,
  solverAddress: string,
) {
  return getChallengeSolverStatusFromApi(
    challengeId,
    solverAddress,
    requireApiUrl(),
  );
}

export async function getSubmissionStatusApi(submissionId: string) {
  return getSubmissionStatusFromApi(submissionId, requireApiUrl());
}

export async function waitForSubmissionStatusApi(
  submissionId: string,
  timeoutSeconds?: number,
) {
  return waitForSubmissionStatusFromApi(
    submissionId,
    { timeoutSeconds },
    requireApiUrl(),
  );
}

export async function getAuthoringSessionTimelineApi(
  sessionId: string,
  input: {
    token: string;
  },
) {
  const payload = await fetchOperatorApiJson(
    `/api/internal/authoring/sessions/${sessionId}/timeline`,
    input,
  );
  return authoringSessionTimelineSchema.parse(payload);
}

export async function* streamSubmissionStatusEventsApi(
  submissionId: string,
  input?: {
    signal?: AbortSignal;
  },
) {
  const response = await fetch(
    `${requireApiUrl()}/api/submissions/${submissionId}/events`,
    {
      headers: {
        accept: "text/event-stream",
      },
      signal: input?.signal,
    },
  );
  if (!response.ok) {
    throw await toApiRequestError(response);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new AgoraError(
      "Submission event stream returned an unexpected content type.",
      {
        code: AGORA_ERROR_CODES.apiRequestFailed,
        retriable: true,
        nextAction:
          "Retry in a few seconds or inspect the API event stream configuration.",
      },
    );
  }
  if (!response.body) {
    throw new AgoraError("Submission event stream is unavailable.", {
      code: AGORA_ERROR_CODES.apiRequestFailed,
      retriable: true,
      nextAction:
        "Retry in a few seconds or inspect the API event stream configuration.",
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replaceAll(
        "\r\n",
        "\n",
      );

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex >= 0) {
        const record = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + 2);
        const parsed = parseSseRecord(record);
        if (parsed) {
          yield parsed;
        }
        boundaryIndex = buffer.indexOf("\n\n");
      }

      if (done) {
        break;
      }
    }

    const trailing = buffer.trim();
    if (trailing.length > 0) {
      const parsed = parseSseRecord(trailing);
      if (parsed) {
        yield parsed;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
