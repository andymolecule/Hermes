import fs from "node:fs";
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

function isHexAddress(value: string | undefined) {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isPrivateKey(value: string | undefined) {
  return !!value && /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function buildDoctorCommand() {
  const cmd = new Command("doctor")
    .description("Validate Hermes CLI configuration and connectivity")
    .option("--format <format>", "table or json", "table")
    .action(async (opts: { format: string }) => {
      const checks: DoctorCheck[] = [];

      const configPath = getConfigPath();
      const hasConfigFile = fs.existsSync(configPath);
      checks.push({
        name: "Config file",
        status: hasConfigFile ? "ok" : "warn",
        detail: hasConfigFile ? configPath : "No ~/.hermes/config.json found",
      });

      const config = loadCliConfig();
      applyConfigToEnv(config);

      checks.push({
        name: "RPC URL",
        status: config.rpc_url ? "ok" : "error",
        detail: config.rpc_url ? "configured" : "HERMES_RPC_URL missing",
      });
      checks.push({
        name: "Factory address",
        status: isHexAddress(config.factory_address) ? "ok" : "error",
        detail: isHexAddress(config.factory_address)
          ? "valid address"
          : "HERMES_FACTORY_ADDRESS missing or invalid",
      });
      checks.push({
        name: "USDC address",
        status: isHexAddress(config.usdc_address) ? "ok" : "error",
        detail: isHexAddress(config.usdc_address)
          ? "valid address"
          : "HERMES_USDC_ADDRESS missing or invalid",
      });
      checks.push({
        name: "Supabase",
        status: config.supabase_url && config.supabase_anon_key ? "ok" : "warn",
        detail:
          config.supabase_url && config.supabase_anon_key
            ? "configured"
            : "HERMES_SUPABASE_URL or HERMES_SUPABASE_ANON_KEY missing",
      });
      checks.push({
        name: "Pinata JWT",
        status: config.pinata_jwt ? "ok" : "warn",
        detail: config.pinata_jwt ? "configured" : "HERMES_PINATA_JWT missing",
      });
      checks.push({
        name: "Private key",
        status: isPrivateKey(config.private_key) ? "ok" : "warn",
        detail: isPrivateKey(config.private_key)
          ? "configured"
          : "HERMES_PRIVATE_KEY missing or invalid",
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
