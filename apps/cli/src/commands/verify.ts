import { verifySubmission } from "@agora/agent-runtime";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { ensurePrivateKey } from "../lib/wallet";

export function buildVerifyCommand() {
  const cmd = new Command("verify")
    .description(
      "Re-run scorer and compare local score with stored on-chain score",
    )
    .argument("<challengeId>", "Challenge id")
    .requiredOption("--sub <submissionId>", "Submission UUID")
    .option("--key <ref>", "Private key reference for verifier identity")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        challengeId: string,
        opts: { sub: string; key?: string; format: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, [
          "supabase_url",
          "supabase_service_key",
          "rpc_url",
        ]);

        if (opts.key) {
          ensurePrivateKey(opts.key);
        }

        const output = await verifySubmission({
          challengeId,
          submissionId: opts.sub,
          recordVerification: true,
        });

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        if (output.match) {
          printSuccess(
            "MATCH: verification score is within tolerance (<= 0.001)",
          );
        } else {
          printWarning(
            "MISMATCH: verification score differs by more than 0.001",
          );
        }
        printJson(output);
      },
    );

  return cmd;
}
