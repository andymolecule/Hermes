import { getIndexerHealthFromApi } from "@agora/agent-runtime";
import { getPublicRpcUrlForChainId } from "@agora/common";
import { Command } from "commander";
import { z } from "zod";
import {
  getConfigValue,
  loadDisplayedCliConfig,
  readConfigFile,
  setConfigValue,
  writeConfigFile,
} from "../lib/config-store";
import { printJson, printTable } from "../lib/output";

const CONFIG_KEYS = [
  "rpc_url",
  "api_url",
  "agent_api_key",
  "pinata_jwt",
  "private_key",
  "factory_address",
  "usdc_address",
  "chain_id",
  "supabase_url",
  "supabase_anon_key",
  "supabase_service_key",
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];

const configInitOptionsSchema = z.object({
  apiUrl: z.string().url(),
  format: z.enum(["table", "json"]).default("table"),
});

function assertKey(key: string): asserts key is ConfigKey {
  if (!CONFIG_KEYS.includes(key as ConfigKey)) {
    throw new Error(`Unknown config key: ${key}`);
  }
}

export function buildConfigCommand() {
  const config = new Command("config").description("Manage Agora CLI config");

  config
    .command("init")
    .description("Bootstrap public solver config from the Agora API")
    .requiredOption("--api-url <url>", "Agora API base URL")
    .option("--format <format>", "table or json", "table")
    .action(
      async (rawOpts: {
        apiUrl: string;
        format?: string;
      }) => {
        const opts = configInitOptionsSchema.parse(rawOpts);
        const apiUrl = opts.apiUrl.replace(/\/$/, "");
        const health = await getIndexerHealthFromApi(apiUrl);
        const existing = readConfigFile();
        const discoveredRpcUrl = getPublicRpcUrlForChainId(
          health.configured.chainId,
        );
        const nextConfig = {
          ...existing,
          api_url: apiUrl,
          chain_id: health.configured.chainId,
          factory_address: health.configured.factoryAddress,
          usdc_address: health.configured.usdcAddress,
          rpc_url: existing.rpc_url ?? discoveredRpcUrl ?? undefined,
        };
        writeConfigFile(nextConfig);

        const rpcSource = existing.rpc_url
          ? "preserved"
          : discoveredRpcUrl
            ? "default"
            : "manual";
        const payload = {
          api_url: apiUrl,
          rpc_url: nextConfig.rpc_url ?? null,
          chain_id: nextConfig.chain_id,
          factory_address: nextConfig.factory_address,
          usdc_address: nextConfig.usdc_address,
          rpc_source: rpcSource,
        };

        if (opts.format === "json") {
          printJson(payload);
          return;
        }

        printTable(
          Object.entries(payload).map(([key, value]) => ({
            key,
            value: value ?? "",
          })),
        );
      },
    );

  config
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .description("Set a config value")
    .addHelpText(
      "after",
      '\nExamples:\n  agora config set api_url "https://agora-market.vercel.app"\n  agora config set private_key env:AGORA_PRIVATE_KEY\n',
    )
    .option("--format <format>", "table or json", "json")
    .action((key: string, value: string, opts: { format: string }) => {
      assertKey(key);
      setConfigValue(key, value);
      if (opts.format === "json") {
        printJson({ key, value });
        return;
      }
      printTable([{ key, value }]);
    });

  config
    .command("get")
    .argument("<key>")
    .description("Get a config value")
    .option("--format <format>", "text, table, or json", "text")
    .action((key: string, opts: { format: string }) => {
      assertKey(key);
      const value = getConfigValue(key);
      if (opts.format === "text") {
        console.log(value ?? "");
        return;
      }
      if (opts.format === "json") {
        printJson({ key, value });
        return;
      }
      printTable([{ key, value: value ?? "" }]);
    });

  config
    .command("list")
    .description("List config values")
    .option("--format <format>", "table or json", "table")
    .action((opts: { format: string }) => {
      const data = loadDisplayedCliConfig();
      const rows = CONFIG_KEYS.map((key) => ({ key, value: data[key] ?? "" }));
      if (opts.format === "json") {
        printJson(data);
        return;
      }
      printTable(rows as Record<string, unknown>[]);
    });

  return config;
}
