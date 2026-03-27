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

const READINESS_CACHE_TTL_MS = 5_000;

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

export function createApiRuntimeReadinessProbe(
  dependencies: {
    createSupabaseClientImpl?: typeof createSupabaseClient;
    readRuntimeDatabaseSchemaStatusImpl?: typeof readRuntimeDatabaseSchemaStatus;
    readAuthoringPublishRuntimeConfigImpl?: typeof readAuthoringPublishRuntimeConfig;
  } = {},
) {
  const createDb =
    dependencies.createSupabaseClientImpl ?? createSupabaseClient;
  const readSchemaStatus =
    dependencies.readRuntimeDatabaseSchemaStatusImpl ??
    readRuntimeDatabaseSchemaStatus;
  const readAuthoringPublishRuntime =
    dependencies.readAuthoringPublishRuntimeConfigImpl ??
    readAuthoringPublishRuntimeConfig;

  let cached: ApiRuntimeReadiness | null = null;
  let cachedAt = 0;
  let inFlight: Promise<ApiRuntimeReadiness> | null = null;

  return async function getRuntimeReadiness() {
    const now = Date.now();
    if (cached && now - cachedAt < READINESS_CACHE_TTL_MS) {
      return cached;
    }
    if (inFlight) {
      return inFlight;
    }

    inFlight = (async () => {
      let contract = toMissingContractStatus();
      let failures: RuntimeSchemaFailure[] = [];
      try {
        const db = createDb(true);
        const status = await readSchemaStatus(db);
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
}
