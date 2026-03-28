import { createPublicKey } from "node:crypto";
import {
  type SealedSubmissionValidationCode,
  computeSubmissionSealPublicKeyFingerprint,
  hasSubmissionSealWorkerConfig,
  loadConfig,
  readWorkerInternalServerRuntimeConfig,
  resolveSubmissionOpenPrivateKeyPem,
  resolveSubmissionOpenPrivateKeys,
  sealedSubmissionValidationRequestSchema,
  sealedSubmissionValidationResponseSchema,
  submissionSealWorkerHealthResponseSchema,
} from "@agora/common";
import { SealedSubmissionError, resolveSubmissionSource } from "@agora/scorer";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { workerLogger } from "../lib/observability.js";

function readBearerToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function derivePublicKeyFingerprint(privateKeyPem: string) {
  const publicKeyPem = createPublicKey(privateKeyPem).export({
    type: "spki",
    format: "pem",
  });
  return computeSubmissionSealPublicKeyFingerprint(String(publicKeyPem));
}

function buildSealFingerprintSnapshot(config: ReturnType<typeof loadConfig>) {
  if (!hasSubmissionSealWorkerConfig(config)) {
    return {
      configured: false,
      keyId: null,
      publicKeyFingerprint: null,
      derivedPublicKeyFingerprint: null,
      selfCheckOk: false,
    };
  }

  const keyId = config.AGORA_SUBMISSION_SEAL_KEY_ID as string;
  const publicKeyPem = config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM as string;
  const privateKeyPem = resolveSubmissionOpenPrivateKeyPem(keyId, config);
  const publicKeyFingerprint =
    computeSubmissionSealPublicKeyFingerprint(publicKeyPem);
  const derivedPublicKeyFingerprint = privateKeyPem
    ? derivePublicKeyFingerprint(privateKeyPem)
    : null;

  return {
    configured: true,
    keyId,
    publicKeyFingerprint,
    derivedPublicKeyFingerprint,
    selfCheckOk:
      Boolean(derivedPublicKeyFingerprint) &&
      publicKeyFingerprint === derivedPublicKeyFingerprint,
  };
}

function createValidationFailure(input: {
  code: SealedSubmissionValidationCode;
  message: string;
  retriable: boolean;
  snapshot: ReturnType<typeof buildSealFingerprintSnapshot>;
}) {
  return sealedSubmissionValidationResponseSchema.parse({
    ok: false,
    code: input.code,
    message: input.message,
    retriable: input.retriable,
    keyId: input.snapshot.keyId,
    publicKeyFingerprint: input.snapshot.publicKeyFingerprint,
    derivedPublicKeyFingerprint: input.snapshot.derivedPublicKeyFingerprint,
  });
}

type WorkerInternalDependencies = {
  loadConfigImpl?: typeof loadConfig;
  resolveSubmissionSourceImpl?: typeof resolveSubmissionSource;
  readWorkerInternalServerRuntimeConfigImpl?: typeof readWorkerInternalServerRuntimeConfig;
  nowImpl?: () => string;
};

export function createWorkerInternalApp(
  dependencies: WorkerInternalDependencies = {},
) {
  const app = new Hono();
  const loadConfigImpl = dependencies.loadConfigImpl ?? loadConfig;
  const resolveSubmissionSourceImpl =
    dependencies.resolveSubmissionSourceImpl ?? resolveSubmissionSource;
  const readWorkerInternalServerRuntimeConfigImpl =
    dependencies.readWorkerInternalServerRuntimeConfigImpl ??
    readWorkerInternalServerRuntimeConfig;
  const nowImpl = dependencies.nowImpl ?? (() => new Date().toISOString());

  app.use("/internal/*", async (c, next) => {
    const runtimeConfig = readWorkerInternalServerRuntimeConfigImpl();
    const token = readBearerToken(c.req.header("authorization"));
    if (!runtimeConfig.authToken || token !== runtimeConfig.authToken) {
      return c.json(
        {
          error: "Unauthorized",
          code: "UNAUTHORIZED",
          retriable: false,
          nextAction:
            "Provide Authorization: Bearer <AGORA_WORKER_INTERNAL_TOKEN> and retry.",
        },
        401,
      );
    }
    await next();
  });

  app.get("/internal/sealed-submissions/healthz", (c) => {
    const config = loadConfigImpl();
    const snapshot = buildSealFingerprintSnapshot(config);
    const payload = submissionSealWorkerHealthResponseSchema.parse({
      ok: snapshot.configured && snapshot.selfCheckOk,
      service: "submission-seal-worker",
      checkedAt: nowImpl(),
      sealing: snapshot,
    });
    return c.json(payload, payload.ok ? 200 : 503);
  });

  app.post("/internal/sealed-submissions/validate", async (c) => {
    const config = loadConfigImpl();
    const snapshot = buildSealFingerprintSnapshot(config);
    if (!snapshot.configured) {
      return c.json(
        createValidationFailure({
          code: "submission_sealing_unavailable",
          message:
            "Submission sealing is not configured on the worker. Next step: restore the sealing keypair and retry.",
          retriable: true,
          snapshot,
        }),
        503,
      );
    }
    if (!snapshot.selfCheckOk) {
      return c.json(
        createValidationFailure({
          code: "missing_decryption_key",
          message:
            "Worker sealing keypair self-check failed. Next step: restore the matching worker private key and retry.",
          retriable: true,
          snapshot,
        }),
        503,
      );
    }

    const rawBody = await c.req.json().catch(() => null);
    const parsed = sealedSubmissionValidationRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        createValidationFailure({
          code: "invalid_request",
          message:
            "Worker validation request is invalid. Next step: send challengeId, solverAddress, and resultCid, then retry.",
          retriable: false,
          snapshot,
        }),
        400,
      );
    }

    try {
      await resolveSubmissionSourceImpl({
        submissionCid: parsed.data.resultCid,
        challengeId: parsed.data.challengeId,
        solverAddress: parsed.data.solverAddress,
        privateKeyPemsByKid: resolveSubmissionOpenPrivateKeys(config),
      });
      return c.json(
        sealedSubmissionValidationResponseSchema.parse({
          ok: true,
          keyId: snapshot.keyId,
          publicKeyFingerprint: snapshot.publicKeyFingerprint,
          derivedPublicKeyFingerprint: snapshot.derivedPublicKeyFingerprint,
        }),
      );
    } catch (error) {
      if (error instanceof SealedSubmissionError) {
        return c.json(
          createValidationFailure({
            code: error.code as SealedSubmissionValidationCode,
            message: error.message,
            retriable:
              error.code === "missing_decryption_key" ||
              error.code === "submission_sealing_unavailable",
            snapshot,
          }),
          error.code === "missing_decryption_key" ? 503 : 400,
        );
      }

      workerLogger.warn(
        {
          event: "worker.validation.ipfs_fetch_failed",
          error: error instanceof Error ? error.message : String(error),
          resultCid: parsed.data.resultCid,
        },
        "Worker validation failed while reading the sealed submission artifact",
      );
      return c.json(
        createValidationFailure({
          code: "ipfs_fetch_failed",
          message:
            error instanceof Error
              ? error.message
              : "Failed to fetch the sealed submission artifact.",
          retriable: true,
          snapshot,
        }),
        503,
      );
    }
  });

  return app;
}

export function startWorkerInternalServer(
  dependencies: WorkerInternalDependencies = {},
) {
  const runtimeConfig =
    dependencies.readWorkerInternalServerRuntimeConfigImpl?.() ??
    readWorkerInternalServerRuntimeConfig();
  if (!runtimeConfig.authToken) {
    return null;
  }

  const app = createWorkerInternalApp(dependencies);
  const serverOptions = {
    fetch: app.fetch,
    port: runtimeConfig.port,
    ...(runtimeConfig.host ? { hostname: runtimeConfig.host } : {}),
  };
  serve(serverOptions);

  workerLogger.info(
    {
      event: "worker.internal_server.started",
      port: runtimeConfig.port,
      host: runtimeConfig.host ?? null,
    },
    "Worker internal validation server listening",
  );

  return {
    port: runtimeConfig.port,
    host: runtimeConfig.host,
  };
}
