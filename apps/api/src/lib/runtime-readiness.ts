import {
  AUTHORING_PUBLISH_RUNTIME_CONFIG_NEXT_STEP,
  readAuthoringPublishRuntimeConfig,
} from "@agora/common";
import {
  AGORA_RUNTIME_SCHEMA_CONTRACT,
  type RuntimeSchemaContractStatus,
  type RuntimeSchemaFailure,
  createSupabaseClient,
  readRuntimeDatabaseSchemaStatus,
} from "@agora/db";

const READINESS_REFRESH_INTERVAL_MS = 5_000;
const READINESS_SCHEMA_TIMEOUT_MS = 8_000;

export interface ApiRuntimeReadiness {
  ok: boolean;
  checkedAt: string;
  readiness: {
    databaseSchema: {
      ok: boolean;
      contract: RuntimeSchemaContractStatus;
      failures: RuntimeSchemaFailure[];
    };
    authoringPublishConfig: {
      ok: boolean;
      failures: RuntimeReadinessFailure[];
    };
  };
}

export interface RuntimeReadinessFailure {
  checkId: string;
  message: string;
  nextStep: string;
}

interface RuntimeReadinessProbeOptions {
  readinessRefreshIntervalMs?: number;
  readinessSchemaTimeoutMs?: number;
}

function toRuntimeReadinessFailure(message: string): RuntimeSchemaFailure {
  return {
    checkId: "database_schema_probe",
    table: "runtime",
    operation: "select",
    select: "schema",
    message,
    nextStep:
      "Verify AGORA_SUPABASE_URL and service credentials, then rerun the runtime schema checks before accepting traffic.",
  };
}

function toMissingContractStatus(): RuntimeSchemaContractStatus {
  return {
    ok: false,
    expected: AGORA_RUNTIME_SCHEMA_CONTRACT,
    actual: null,
  };
}

function toAuthoringPublishConfigFailure(
  message: string,
): RuntimeReadinessFailure {
  return {
    checkId: "authoring_publish_runtime_config",
    message,
    nextStep: AUTHORING_PUBLISH_RUNTIME_CONFIG_NEXT_STEP,
  };
}

function toWarmupReadiness() {
  return {
    ok: false,
    checkedAt: new Date().toISOString(),
    readiness: {
      databaseSchema: {
        ok: false,
        contract: toMissingContractStatus(),
        failures: [
          toRuntimeReadinessFailure("Runtime readiness is still warming up."),
        ],
      },
      authoringPublishConfig: {
        ok: false,
        failures: [
          toAuthoringPublishConfigFailure(
            "Authoring publish readiness is still warming up.",
          ),
        ],
      },
    },
  } satisfies ApiRuntimeReadiness;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(onTimeout());
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createApiRuntimeReadinessProbe(
  dependencies: {
    createSupabaseClientImpl?: typeof createSupabaseClient;
    readRuntimeDatabaseSchemaStatusImpl?: typeof readRuntimeDatabaseSchemaStatus;
    readAuthoringPublishRuntimeConfigImpl?: typeof readAuthoringPublishRuntimeConfig;
  } & RuntimeReadinessProbeOptions = {},
) {
  const createDb =
    dependencies.createSupabaseClientImpl ?? createSupabaseClient;
  const readSchemaStatus =
    dependencies.readRuntimeDatabaseSchemaStatusImpl ??
    readRuntimeDatabaseSchemaStatus;
  const readAuthoringPublishRuntime =
    dependencies.readAuthoringPublishRuntimeConfigImpl ??
    readAuthoringPublishRuntimeConfig;
  const refreshIntervalMs =
    dependencies.readinessRefreshIntervalMs ?? READINESS_REFRESH_INTERVAL_MS;
  const schemaTimeoutMs =
    dependencies.readinessSchemaTimeoutMs ?? READINESS_SCHEMA_TIMEOUT_MS;

  let db: ReturnType<typeof createSupabaseClient> | null = null;
  let cached: ApiRuntimeReadiness = toWarmupReadiness();
  let cachedAt = 0;
  let inFlight: Promise<ApiRuntimeReadiness> | null = null;

  const refreshReadiness = async () => {
    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      let contract = toMissingContractStatus();
      let failures: RuntimeSchemaFailure[] = [];
      try {
        db ??= createDb(true);
        const status = await withTimeout(
          readSchemaStatus(db),
          schemaTimeoutMs,
          () =>
            new Error(
              `Timed out waiting for database schema readiness after ${schemaTimeoutMs}ms.`,
            ),
        );
        contract = status.contract;
        failures = status.failures;
      } catch (error) {
        failures = [
          toRuntimeReadinessFailure(
            error instanceof Error ? error.message : String(error),
          ),
        ];
      }

      let authoringPublishFailures: RuntimeReadinessFailure[] = [];
      try {
        readAuthoringPublishRuntime();
      } catch (error) {
        authoringPublishFailures = [
          toAuthoringPublishConfigFailure(
            error instanceof Error ? error.message : String(error),
          ),
        ];
      }

      const readiness: ApiRuntimeReadiness = {
        ok: failures.length === 0 && authoringPublishFailures.length === 0,
        checkedAt: new Date().toISOString(),
        readiness: {
          databaseSchema: {
            ok: failures.length === 0,
            contract,
            failures,
          },
          authoringPublishConfig: {
            ok: authoringPublishFailures.length === 0,
            failures: authoringPublishFailures,
          },
        },
      };

      cached = readiness;
      cachedAt = Date.now();
      inFlight = null;
      return readiness;
    })();

    return inFlight;
  };

  void refreshReadiness();
  if (refreshIntervalMs > 0) {
    const timer = setInterval(() => {
      void refreshReadiness();
    }, refreshIntervalMs);
    timer.unref?.();
  }

  return async function getRuntimeReadiness() {
    if (!inFlight && Date.now() - cachedAt >= refreshIntervalMs) {
      void refreshReadiness();
    }
    return cached;
  };
}
