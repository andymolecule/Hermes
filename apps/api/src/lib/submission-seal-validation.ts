import {
  type SealedSubmissionValidationCode,
  readSubmissionValidationRuntimeConfig,
  sealedSubmissionValidationFailureSchema,
  submissionSealWorkerHealthResponseSchema,
  sealedSubmissionValidationRequestSchema,
  sealedSubmissionValidationResponseSchema,
} from "@agora/common";

const SUBMISSION_VALIDATION_TIMEOUT_MS = 10_000;

export class SubmissionSealValidationClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly options?: {
      retriable?: boolean;
    },
  ) {
    super(message);
    this.name = "SubmissionSealValidationClientError";
  }
}

export function hasSubmissionSealValidationBridgeConfig(input?: {
  runtimeConfig?: ReturnType<typeof readSubmissionValidationRuntimeConfig>;
}) {
  const runtimeConfig =
    input?.runtimeConfig ?? readSubmissionValidationRuntimeConfig();
  return Boolean(
    runtimeConfig.workerInternalUrl && runtimeConfig.workerInternalToken,
  );
}

function mapWorkerValidationFailure(
  failure: typeof sealedSubmissionValidationFailureSchema._output,
) {
  switch (failure.code) {
    case "invalid_request":
      return new SubmissionSealValidationClientError(
        503,
        "SUBMISSION_VALIDATION_UNAVAILABLE",
        "Agora sent an invalid worker validation request. Next step: inspect the current API deployment, then retry.",
        { retriable: true },
      );
    case "challenge_id_mismatch":
      return new SubmissionSealValidationClientError(
        409,
        "SEALED_SUBMISSION_CHALLENGE_MISMATCH",
        "Sealed submission challengeId does not match the requested challenge. Next step: reseal the payload for the correct challengeId, re-upload it, and retry.",
      );
    case "solver_address_mismatch":
      return new SubmissionSealValidationClientError(
        409,
        "SEALED_SUBMISSION_SOLVER_MISMATCH",
        "Sealed submission solverAddress does not match the submitting wallet. Next step: reseal the payload with the same solver address you use for the intent and retry.",
      );
    case "ipfs_fetch_failed":
      return new SubmissionSealValidationClientError(
        503,
        "SUBMISSION_ARTIFACT_UNAVAILABLE",
        "Agora could not read the sealed submission artifact from IPFS. Next step: retry after the CID is reachable, or re-upload the artifact and retry.",
        { retriable: true },
      );
    case "missing_decryption_key":
    case "submission_sealing_unavailable":
      return new SubmissionSealValidationClientError(
        503,
        "SUBMISSION_VALIDATION_UNAVAILABLE",
        "Agora cannot validate sealed submissions right now. Next step: retry after the worker sealing keys are restored.",
        { retriable: true },
      );
    case "invalid_envelope_schema":
    case "decrypt_failed":
      return new SubmissionSealValidationClientError(
        400,
        "SEALED_SUBMISSION_INVALID",
        "Agora could not open the sealed submission payload. Next step: fetch /api/submissions/public-key again, reseal the payload with the official helper, re-upload it, and retry.",
      );
    default: {
      const unknownCode: never = failure.code;
      throw new Error(
        `Unhandled sealed submission validation code: ${unknownCode}`,
      );
    }
  }
}

function buildTransportFailure(message: string) {
  return new SubmissionSealValidationClientError(
    503,
    "SUBMISSION_VALIDATION_UNAVAILABLE",
    `${message} Next step: retry after the worker validation service is reachable.`,
    { retriable: true },
  );
}

function requireWorkerValidationBridge(
  runtimeConfig: ReturnType<typeof readSubmissionValidationRuntimeConfig>,
) {
  if (!runtimeConfig.workerInternalUrl || !runtimeConfig.workerInternalToken) {
    throw new SubmissionSealValidationClientError(
      503,
      "SUBMISSION_VALIDATION_UNAVAILABLE",
      "Agora cannot validate sealed submissions because the worker validation bridge is not configured. Next step: set AGORA_WORKER_INTERNAL_URL and AGORA_WORKER_INTERNAL_TOKEN, then retry.",
      { retriable: true },
    );
  }
}

async function fetchWorkerValidationPayload(input: {
  runtimeConfig: ReturnType<typeof readSubmissionValidationRuntimeConfig>;
  path: string;
  method?: "GET" | "POST";
  body?: string;
  fetchImpl?: typeof fetch;
}) {
  requireWorkerValidationBridge(input.runtimeConfig);
  const fetchImpl = input.fetchImpl ?? fetch;
  const workerInternalUrl = input.runtimeConfig.workerInternalUrl as string;
  const workerInternalToken = input.runtimeConfig.workerInternalToken as string;

  let response: Response;
  try {
    response = await fetchImpl(
      `${workerInternalUrl.replace(/\/$/, "")}${input.path}`,
      {
        method: input.method ?? "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${workerInternalToken}`,
          ...(input.body ? { "content-type": "application/json" } : {}),
        },
        body: input.body,
        signal: AbortSignal.timeout(SUBMISSION_VALIDATION_TIMEOUT_MS),
      },
    );
  } catch (error) {
    throw buildTransportFailure(
      error instanceof Error
        ? `Agora could not reach the worker validation service: ${error.message}.`
        : "Agora could not reach the worker validation service.",
    );
  }

  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null;
  } catch {
    throw buildTransportFailure(
      "Agora received a non-JSON response from the worker validation service.",
    );
  }

  return {
    response,
    payload,
  };
}

export async function readSubmissionSealWorkerHealth(input?: {
  fetchImpl?: typeof fetch;
  runtimeConfig?: ReturnType<typeof readSubmissionValidationRuntimeConfig>;
}) {
  const runtimeConfig =
    input?.runtimeConfig ?? readSubmissionValidationRuntimeConfig();
  const { response, payload } = await fetchWorkerValidationPayload({
    runtimeConfig,
    path: "/internal/sealed-submissions/healthz",
    fetchImpl: input?.fetchImpl,
  });
  const parsed = submissionSealWorkerHealthResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw buildTransportFailure(
      "Agora received an invalid worker sealing health response.",
    );
  }
  if (!response.ok) {
    throw buildTransportFailure(
      "Agora received an unhealthy worker sealing health response.",
    );
  }
  return parsed.data;
}

export async function validateSealedSubmissionForIntent(input: {
  resultCid: string;
  challengeId: string;
  solverAddress: string;
  fetchImpl?: typeof fetch;
  runtimeConfig?: ReturnType<typeof readSubmissionValidationRuntimeConfig>;
}) {
  const runtimeConfig =
    input.runtimeConfig ?? readSubmissionValidationRuntimeConfig();
  if (!runtimeConfig.sealingConfigured) {
    throw new SubmissionSealValidationClientError(
      503,
      "SUBMISSION_SEALING_UNAVAILABLE",
      "Sealed submission validation is unavailable because submission sealing is not configured. Next step: retry after sealing is restored.",
      { retriable: true },
    );
  }

  const body = sealedSubmissionValidationRequestSchema.parse({
    resultCid: input.resultCid,
    challengeId: input.challengeId,
    solverAddress: input.solverAddress,
  });
  const { response, payload } = await fetchWorkerValidationPayload({
    runtimeConfig,
    path: "/internal/sealed-submissions/validate",
    method: "POST",
    body: JSON.stringify(body),
    fetchImpl: input.fetchImpl,
  });

  const parsed = sealedSubmissionValidationResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw buildTransportFailure(
      "Agora received an invalid worker validation response.",
    );
  }

  if (!response.ok || !parsed.data.ok) {
    throw mapWorkerValidationFailure(
      parsed.data.ok
        ? {
            ok: false,
            code: "submission_sealing_unavailable",
            message: "Worker validation failed.",
            retriable: true,
            keyId: null,
            publicKeyFingerprint: null,
            derivedPublicKeyFingerprint: null,
          }
        : parsed.data,
    );
  }
}

export function isWorkerValidationFailureCode(
  value: string,
): value is SealedSubmissionValidationCode {
  return sealedSubmissionValidationFailureSchema.shape.code.safeParse(value)
    .success;
}
