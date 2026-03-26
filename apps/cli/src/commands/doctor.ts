import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listOfficialScorerImages,
  listOfficialScorers,
  resolveOciImageToDigest,
} from "@agora/common";
import { verifyRuntimeDatabaseSchema } from "@agora/db";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { http, createPublicClient } from "viem";
import {
  applyConfigToEnv,
  getConfigPath,
  getEnvReferenceName,
  loadCliConfig,
  resolveConfigValue,
} from "../lib/config-store";
import { printJson, printTable } from "../lib/output";
import {
  deriveWalletAddress,
  formatWalletGasBalance,
  getGasTopUpHint,
  readWalletGasBalance,
} from "../lib/wallet";

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

function dockerAvailable() {
  const docker = spawnSync("docker", ["info"], {
    encoding: "utf8",
  });
  return docker.status === 0;
}

function pullOfficialImageAnonymously(image: string) {
  const dockerConfigDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agora-doctor-ghcr-"),
  );
  try {
    const pull = spawnSync("docker", ["pull", image], {
      encoding: "utf8",
      env: {
        ...process.env,
        DOCKER_CONFIG: dockerConfigDir,
      },
    });
    if (pull.status !== 0) {
      throw new Error(pull.stderr || pull.stdout || "docker pull failed");
    }
  } finally {
    fs.rmSync(dockerConfigDir, { recursive: true, force: true });
  }
}

export async function checkOfficialScorerRegistry(
  fetchImpl: typeof fetch = fetch,
) {
  const registryRows = Array.from(
    new Map(
      listOfficialScorers().map((entry) => [
        entry.scorerImageTag,
        {
          tag: entry.scorerImageTag,
          pinned: entry.scorerImage,
        },
      ]),
    ).values(),
  );

  const resolved = await Promise.all(
    registryRows.map(async (row) => {
      const digest = await resolveOciImageToDigest(row.tag, {
        env: {},
        fetchImpl,
      });
      if (digest !== row.pinned) {
        throw new Error(
          `Pinned digest drift detected for ${row.tag}. Next step: update the official scorer registry to the validated digest or restore the immutable tag.`,
        );
      }
      return {
        tag: row.tag,
        digest,
      };
    }),
  );

  return resolved.map((row) => `${row.tag} -> ${row.digest}`).join(", ");
}

export async function checkApiHealth(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const baseUrl = apiUrl.replace(/\/$/, "");
  const healthUrl = `${baseUrl}/api/health`;

  try {
    const response = await fetchImpl(healthUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return "api/health ok";
    }
    throw new Error(`/api/health returned ${response.status}`);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "api health request failed",
    );
  }
}

export async function checkSubmissionPublicKey(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const baseUrl = apiUrl.replace(/\/$/, "");
  const response = await fetchImpl(`${baseUrl}/api/submissions/public-key`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`/api/submissions/public-key returned ${response.status}`);
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: {
      kid?: string;
      version?: string;
    };
  } | null;
  const kid = payload?.data?.kid ?? "unknown";
  const version = payload?.data?.version ?? "unknown";
  return `kid=${kid}, version=${version}`;
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
      const resolvedPrivateKey = resolveConfigValue(config.private_key);
      const privateKeyEnvName = getEnvReferenceName(config.private_key);
      const walletAddress = isPrivateKey(resolvedPrivateKey)
        ? deriveWalletAddress(resolvedPrivateKey).toLowerCase()
        : null;
      applyConfigToEnv(config);

      checks.push({
        name: "API URL",
        status: config.api_url ? "ok" : "warn",
        detail: config.api_url ? "configured" : "AGORA_API_URL missing",
      });
      checks.push({
        name: "Remote discovery ready",
        status: config.api_url ? "ok" : "warn",
        detail: config.api_url
          ? "list/get/status can run"
          : "set AGORA_API_URL to enable discovery and read-only commands",
      });
      checks.push({
        name: "RPC URL",
        status: config.rpc_url ? "ok" : "warn",
        detail: config.rpc_url
          ? "configured"
          : "AGORA_RPC_URL missing; run agora config init --api-url <url> or set it manually",
      });
      checks.push({
        name: "Factory address",
        status: isHexAddress(config.factory_address) ? "ok" : "warn",
        detail: isHexAddress(config.factory_address)
          ? "valid address"
          : "AGORA_FACTORY_ADDRESS missing or invalid; run agora config init --api-url <url>",
      });
      checks.push({
        name: "USDC address",
        status: isHexAddress(config.usdc_address) ? "ok" : "warn",
        detail: isHexAddress(config.usdc_address)
          ? "valid address"
          : "AGORA_USDC_ADDRESS missing or invalid; run agora config init --api-url <url>",
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
        name: "Legacy Supabase read config",
        status: config.supabase_url && config.supabase_anon_key ? "ok" : "skip",
        detail:
          config.supabase_url && config.supabase_anon_key
            ? "configured for legacy/operator workflows"
            : "not required for solver score-local when AGORA_API_URL is configured",
      });
      checks.push({
        name: "Direct Pinata upload",
        status: config.pinata_jwt ? "ok" : "skip",
        detail: config.pinata_jwt
          ? "configured for direct IPFS pinning"
          : "not required for solver submit; the API can upload sealed submissions",
      });
      checks.push({
        name: "Private key",
        status: isPrivateKey(resolvedPrivateKey) ? "ok" : "warn",
        detail: isPrivateKey(resolvedPrivateKey)
          ? "configured"
          : privateKeyEnvName
            ? `${privateKeyEnvName} is missing or invalid`
            : "AGORA_PRIVATE_KEY missing or invalid",
      });
      checks.push({
        name: "Wallet address",
        status: walletAddress ? "ok" : "skip",
        detail: walletAddress ?? "Private key not configured",
      });
      checks.push({
        name: "Solver path ready",
        status:
          Boolean(config.api_url) &&
          Boolean(config.rpc_url) &&
          isHexAddress(config.factory_address) &&
          isHexAddress(config.usdc_address) &&
          isPrivateKey(resolvedPrivateKey)
            ? "ok"
            : "warn",
        detail:
          "requires API URL, RPC, factory, USDC, and a private key for solver preview + submit",
      });

      if (config.api_url) {
        try {
          const detail = await checkApiHealth(config.api_url);
          checks.push({
            name: "API connectivity",
            status: "ok",
            detail,
          });
        } catch (error) {
          checks.push({
            name: "API connectivity",
            status: "error",
            detail:
              error instanceof Error ? error.message : "API request failed",
          });
        }
      } else {
        checks.push({
          name: "API connectivity",
          status: "skip",
          detail: "API URL not configured",
        });
      }

      if (config.api_url) {
        try {
          const detail = await checkSubmissionPublicKey(config.api_url);
          checks.push({
            name: "Submission sealing key",
            status: "ok",
            detail,
          });
        } catch (error) {
          checks.push({
            name: "Submission sealing key",
            status: "error",
            detail:
              error instanceof Error
                ? error.message
                : "public-key request failed",
          });
        }
      } else {
        checks.push({
          name: "Submission sealing key",
          status: "skip",
          detail: "API URL not configured",
        });
      }

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

      if (config.rpc_url && walletAddress) {
        try {
          const balance = await readWalletGasBalance(walletAddress);
          const faucet = getGasTopUpHint(config.chain_id);
          const faucetDetail =
            balance === 0n && faucet ? `; top up via ${faucet}` : "";
          checks.push({
            name: "Wallet gas balance",
            status: balance > 0n ? "ok" : "warn",
            detail: `${formatWalletGasBalance(balance)}${faucetDetail}`,
          });
        } catch (error) {
          checks.push({
            name: "Wallet gas balance",
            status: "error",
            detail:
              error instanceof Error ? error.message : "balance lookup failed",
          });
        }
      } else {
        checks.push({
          name: "Wallet gas balance",
          status: "skip",
          detail: walletAddress
            ? "RPC URL not configured"
            : "Wallet not configured",
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
            .select("id", { count: "exact" })
            .limit(1);
          if (error) {
            throw new Error(
              `Supabase connectivity check failed: ${error.message}`,
            );
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
            .select("id", { count: "exact" })
            .is("factory_address", null)
            .limit(1);
          if (error) {
            throw new Error(
              `Challenge factory completeness query failed: ${error.message}`,
            );
          }
          const missingCount = count ?? 0;
          checks.push({
            name: "Challenge factory completeness",
            status: missingCount === 0 ? "ok" : "warn",
            detail:
              missingCount === 0
                ? "all challenge rows have factory_address"
                : `${missingCount} challenge rows are missing factory_address`,
          });
        } catch (error) {
          checks.push({
            name: "Challenge factory completeness",
            status: "error",
            detail:
              error instanceof Error
                ? error.message
                : "Challenge factory completeness query failed",
          });
        }
      } else {
        checks.push({
          name: "Challenge factory completeness",
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
        checks.push({
          name: "Official scorer manifest access",
          status: "ok",
          detail: await checkOfficialScorerRegistry(),
        });
      } catch (error) {
        checks.push({
          name: "Official scorer manifest access",
          status: "error",
          detail:
            error instanceof Error
              ? error.message
              : "Official scorer manifest access check failed",
        });
      }

      if (!dockerAvailable()) {
        checks.push({
          name: "Official scorer docker pull",
          status: "skip",
          detail: "Docker unavailable on this machine",
        });
      } else {
        try {
          const officialImages = Array.from(
            new Set(listOfficialScorerImages()),
          );
          for (const image of officialImages) {
            pullOfficialImageAnonymously(image);
          }
          checks.push({
            name: "Official scorer docker pull",
            status: "ok",
            detail: officialImages.join(", "),
          });
        } catch (error) {
          checks.push({
            name: "Official scorer docker pull",
            status: "error",
            detail:
              error instanceof Error
                ? error.message
                : "Official scorer docker pull check failed",
          });
        }
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
