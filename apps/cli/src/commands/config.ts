import { Command } from "commander";
import { getConfigValue, loadCliConfig, setConfigValue } from "../lib/config-store";
import { printJson, printTable } from "../lib/output";

const CONFIG_KEYS = [
  "rpc_url",
  "api_url",
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

function assertKey(key: string): asserts key is ConfigKey {
  if (!CONFIG_KEYS.includes(key as ConfigKey)) {
    throw new Error(`Unknown config key: ${key}`);
  }
}

export function buildConfigCommand() {
  const config = new Command("config").description("Manage Hermes CLI config");

  config
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .description("Set a config value")
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
        // biome-ignore lint/suspicious/noConsole: CLI output
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
      const data = loadCliConfig();
      const rows = CONFIG_KEYS.map((key) => ({ key, value: data[key] ?? "" }));
      if (opts.format === "json") {
        printJson(data);
        return;
      }
      printTable(rows as Record<string, unknown>[]);
    });

  return config;
}
