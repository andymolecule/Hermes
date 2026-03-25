import {
  createSupabaseClient,
  type RuntimeSchemaFailure,
  verifyRuntimeDatabaseSchema,
} from "@agora/db";

const READINESS_CACHE_TTL_MS = 5_000;

export interface ApiRuntimeReadiness {
  ok: boolean;
  checkedAt: string;
  readiness: {
    databaseSchema: {
      ok: boolean;
      failures: RuntimeSchemaFailure[];
    };
  };
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

export function createApiRuntimeReadinessProbe(dependencies: {
  createSupabaseClientImpl?: typeof createSupabaseClient;
  verifyRuntimeDatabaseSchemaImpl?: typeof verifyRuntimeDatabaseSchema;
} = {}) {
  const createDb =
    dependencies.createSupabaseClientImpl ?? createSupabaseClient;
  const verifySchema =
    dependencies.verifyRuntimeDatabaseSchemaImpl ?? verifyRuntimeDatabaseSchema;

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
      let failures: RuntimeSchemaFailure[] = [];
      try {
        const db = createDb(true);
        failures = await verifySchema(db);
      } catch (error) {
        failures = [
          toRuntimeReadinessFailure(
            error instanceof Error ? error.message : String(error),
          ),
        ];
      }

      const readiness: ApiRuntimeReadiness = {
        ok: failures.length === 0,
        checkedAt: new Date().toISOString(),
        readiness: {
          databaseSchema: {
            ok: failures.length === 0,
            failures,
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
