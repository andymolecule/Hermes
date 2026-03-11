import fs from "node:fs";
import { OFFICIAL_IMAGES, resolveOfficialImageToDigest } from "@agora/common";
import { verifyRuntimeDatabaseSchema } from "@agora/db";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { http, createPublicClient } from "viem";
import {
  applyConfigToEnv,
  getConfigPath,
  loadCliConfig,
} from "../lib/config-store";
import { printJson, printTable } from "../lib/output";

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "error" | "skip";
  detail: string;
}

const ACTIVE_FACTORY_CURSOR_WINDOW_MS = 15 * 60 * 1000;

function isHexAddress(value: string | undefined) {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isPrivateKey(value: string | undefined) {
  return !!value && /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function buildDoctorCommand() {
  const cmd = new Command("doctor")
    .description("Validate Agora CLI configuration and connectivity")
    .option("--format <format>", "table or json", "table")
    .action(async (opts: { format: string }) => {
      const checks: DoctorCheck[] = [];

      const configPath = getConfigPath();
      const hasConfigFile = fs.existsSync(configPath);
      checks.push({
        name: "Config file",
        status: hasConfigFile ? "ok" : "warn",
        detail: hasConfigFile ? configPath : "No ~/.agora/config.json found",
      });

      const config = loadCliConfig();
      applyConfigToEnv(config);

      checks.push({
        name: "RPC URL",
        status: config.rpc_url ? "ok" : "error",
        detail: config.rpc_url ? "configured" : "AGORA_RPC_URL missing",
      });
      checks.push({
        name: "Factory address",
        status: isHexAddress(config.factory_address) ? "ok" : "error",
        detail: isHexAddress(config.factory_address)
          ? "valid address"
          : "AGORA_FACTORY_ADDRESS missing or invalid",
      });
      checks.push({
        name: "USDC address",
        status: isHexAddress(config.usdc_address) ? "ok" : "error",
        detail: isHexAddress(config.usdc_address)
          ? "valid address"
          : "AGORA_USDC_ADDRESS missing or invalid",
      });
      checks.push({
        name: "Runtime identity",
        status:
          config.chain_id &&
          isHexAddress(config.factory_address) &&
          isHexAddress(config.usdc_address)
            ? "ok"
            : "warn",
        detail: `chainId=${config.chain_id ?? "?"} factory=${config.factory_address ?? "missing"} usdc=${config.usdc_address ?? "missing"}`,
      });
      checks.push({
        name: "Supabase",
        status: config.supabase_url && config.supabase_anon_key ? "ok" : "warn",
        detail:
          config.supabase_url && config.supabase_anon_key
            ? "configured"
            : "AGORA_SUPABASE_URL or AGORA_SUPABASE_ANON_KEY missing",
      });
      checks.push({
        name: "Pinata JWT",
        status: config.pinata_jwt ? "ok" : "warn",
        detail: config.pinata_jwt ? "configured" : "AGORA_PINATA_JWT missing",
      });
      checks.push({
        name: "Private key",
        status: isPrivateKey(config.private_key) ? "ok" : "warn",
        detail: isPrivateKey(config.private_key)
          ? "configured"
          : "AGORA_PRIVATE_KEY missing or invalid",
      });

      if (config.rpc_url) {
        try {
          const publicClient = createPublicClient({
            transport: http(config.rpc_url),
          });
          const [chainId, block] = await Promise.all([
            publicClient.getChainId(),
            publicClient.getBlockNumber(),
          ]);
          checks.push({
            name: "RPC connectivity",
            status: "ok",
            detail: `chainId=${chainId}, latestBlock=${block}`,
          });
        } catch (error) {
          checks.push({
            name: "RPC connectivity",
            status: "error",
            detail:
              error instanceof Error ? error.message : "RPC request failed",
          });
        }
      } else {
        checks.push({
          name: "RPC connectivity",
          status: "skip",
          detail: "RPC URL not configured",
        });
      }

      if (config.rpc_url && isHexAddress(config.factory_address)) {
        try {
          const publicClient = createPublicClient({
            transport: http(config.rpc_url),
          });
          const code = await publicClient.getBytecode({
            address: config.factory_address as `0x${string}`,
          });
          const hasCode = !!code && code !== "0x";
          checks.push({
            name: "Factory contract",
            status: hasCode ? "ok" : "warn",
            detail: hasCode ? "bytecode found" : "no bytecode at address",
          });
        } catch (error) {
          checks.push({
            name: "Factory contract",
            status: "error",
            detail:
              error instanceof Error ? error.message : "Factory lookup failed",
          });
        }
      } else {
        checks.push({
          name: "Factory contract",
          status: "skip",
          detail: "RPC or factory address missing",
        });
      }

      if (config.rpc_url && isHexAddress(config.usdc_address)) {
        try {
          const publicClient = createPublicClient({
            transport: http(config.rpc_url),
          });
          const code = await publicClient.getBytecode({
            address: config.usdc_address as `0x${string}`,
          });
          const hasCode = !!code && code !== "0x";
          checks.push({
            name: "USDC contract",
            status: hasCode ? "ok" : "warn",
            detail: hasCode ? "bytecode found" : "no bytecode at address",
          });
        } catch (error) {
          checks.push({
            name: "USDC contract",
            status: "error",
            detail:
              error instanceof Error ? error.message : "USDC lookup failed",
          });
        }
      } else {
        checks.push({
          name: "USDC contract",
          status: "skip",
          detail: "RPC or USDC address missing",
        });
      }

      if (config.supabase_url && config.supabase_anon_key) {
        try {
          const db = createSupabaseClient(
            config.supabase_url,
            config.supabase_anon_key,
            {
              auth: { persistSession: false },
            },
          );
          const { error } = await db
            .from("challenges")
            .select("id", { count: "exact", head: true })
            .limit(1);
          if (error) {
            throw new Error(error.message);
          }
          checks.push({
            name: "Supabase connectivity",
            status: "ok",
            detail: "query ok",
          });
        } catch (error) {
          checks.push({
            name: "Supabase connectivity",
            status: "error",
            detail:
              error instanceof Error ? error.message : "Supabase query failed",
          });
        }
      } else {
        checks.push({
          name: "Supabase connectivity",
          status: "skip",
          detail: "Supabase config missing",
        });
      }

      if (
        config.supabase_url &&
        config.supabase_service_key &&
        config.chain_id &&
        isHexAddress(config.factory_address)
      ) {
        try {
          const db = createSupabaseClient(
            config.supabase_url,
            config.supabase_service_key,
            {
              auth: { persistSession: false },
            },
          );
          const cursorPrefix = `factory:${config.chain_id}:`;
          const configuredCursorKey = `${cursorPrefix}${config.factory_address.toLowerCase()}`;
          const { data: cursorRows, error } = await db
            .from("indexer_cursors")
            .select("cursor_key, block_number, updated_at")
            .like("cursor_key", `${cursorPrefix}%`)
            .order("updated_at", { ascending: false });
          if (error) {
            throw new Error(error.message);
          }

          const configuredCursor = (cursorRows ?? []).find(
            (row) => row.cursor_key === configuredCursorKey,
          );
          const activeAlternates = (cursorRows ?? [])
            .filter((row) => row.cursor_key !== configuredCursorKey)
            .filter((row) => {
              const updatedAtMs = Date.parse(String(row.updated_at ?? ""));
              return (
                Number.isFinite(updatedAtMs) &&
                Date.now() - updatedAtMs <= ACTIVE_FACTORY_CURSOR_WINDOW_MS
              );
            });
          const status =
            activeAlternates.length > 0
              ? "warn"
              : configuredCursor
                ? "ok"
                : "warn";
          checks.push({
            name: "Indexer cursor alignment",
            status,
            detail: configuredCursor
              ? `configuredBlock=${configuredCursor.block_number} alternateActiveFactories=${activeAlternates.length}`
              : `configured cursor missing; alternateActiveFactories=${activeAlternates.length}`,
          });
        } catch (error) {
          checks.push({
            name: "Indexer cursor alignment",
            status: "error",
            detail:
              error instanceof Error
                ? error.message
                : "Indexer cursor query failed",
          });
        }
      } else {
        checks.push({
          name: "Indexer cursor alignment",
          status: "skip",
          detail: "Supabase service key, chain id, or factory address missing",
        });
      }

      if (config.supabase_url && config.supabase_service_key) {
        try {
          const db = createSupabaseClient(
            config.supabase_url,
            config.supabase_service_key,
            {
              auth: { persistSession: false },
            },
          );
          const { count, error } = await db
            .from("challenges")
            .select("id", { count: "exact", head: true })
            .is("factory_address", null);
          if (error) {
            throw new Error(error.message);
          }
          const missingCount = count ?? 0;
          checks.push({
            name: "Challenge factory backfill",
            status: missingCount === 0 ? "ok" : "warn",
            detail:
              missingCount === 0
                ? "all challenge rows have factory_address"
                : `${missingCount} challenge rows are missing factory_address`,
          });
        } catch (error) {
          checks.push({
            name: "Challenge factory backfill",
            status: "error",
            detail:
              error instanceof Error
                ? error.message
                : "Challenge backfill query failed",
          });
        }
      } else {
        checks.push({
          name: "Challenge factory backfill",
          status: "skip",
          detail: "Supabase service key missing",
        });
      }

      if (config.supabase_url && config.supabase_service_key) {
        try {
          const db = createSupabaseClient(
            config.supabase_url,
            config.supabase_service_key,
            {
              auth: { persistSession: false },
            },
          );
          const failures = await verifyRuntimeDatabaseSchema(db as never);
          checks.push({
            name: "Runtime DB schema",
            status: failures.length === 0 ? "ok" : "error",
            detail:
              failures.length === 0
                ? "required runtime columns are queryable"
                : failures.map((failure) => failure.checkId).join(", "),
          });
        } catch (error) {
          checks.push({
            name: "Runtime DB schema",
            status: "error",
            detail:
              error instanceof Error
                ? error.message
                : "Runtime schema check failed",
          });
        }
      } else {
        checks.push({
          name: "Runtime DB schema",
          status: "skip",
          detail: "Supabase service key missing",
        });
      }

      try {
        const resolved = await Promise.all(
          Object.values(OFFICIAL_IMAGES).map((image) =>
            resolveOfficialImageToDigest(image).then((digest) => ({
              image,
              digest,
            })),
          ),
        );
        checks.push({
          name: "Official scorer registry",
          status: "ok",
          detail: resolved.map((row) => row.digest).join(", "),
        });
      } catch (error) {
        checks.push({
          name: "Official scorer registry",
          status: "error",
          detail:
            error instanceof Error
              ? error.message
              : "Official scorer registry check failed",
        });
      }

      if (opts.format === "json") {
        printJson({ checks });
        return;
      }

      printTable(
        checks.map((check) => ({
          name: check.name,
          status: check.status,
          detail: check.detail,
        })),
      );
    });

  return cmd;
}
