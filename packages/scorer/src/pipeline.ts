import fs from "node:fs/promises";
import path from "node:path";
import {
  type CsvTableEvaluationContractOutput,
  DEFAULT_SCORER_MOUNT,
  SCORER_RUNTIME_CONFIG_FILE_NAME,
  type ScorerRuntimePoliciesOutput,
  type ScoringMountConfig,
  type SubmissionContractOutput,
  buildScorerRuntimeConfig,
  challengeSpecSchema,
  parseChallengeSpecDocument,
  resolvePinnedChallengeExecution,
  resolveScoringEnvironmentFromSpec,
  validateSubmissionBytesAgainstContract,
} from "@agora/common";
import { downloadToPath, getText } from "@agora/ipfs";
import { executeScorer } from "./execution.js";
import type { RunScorerInput, RunnerScoreResult } from "./runner.js";
import { cleanupWorkspace, createScoringWorkspace } from "./staging.js";

export interface ScoringInputSource {
  cid?: string;
  localPath?: string;
  content?: string;
  bytes?: Uint8Array;
}

export type ScoringPipelinePhase = "fetch_inputs" | "run_scorer";

export interface ScoringPipelinePhaseObserver {
  onPhaseStart?: (phase: ScoringPipelinePhase) => void | Promise<void>;
  onPhaseSuccess?: (
    phase: ScoringPipelinePhase,
    durationMs: number,
  ) => void | Promise<void>;
  onPhaseError?: (
    phase: ScoringPipelinePhase,
    durationMs: number,
    error: unknown,
  ) => void | Promise<void>;
}

export interface ExecuteScoringPipelineInput {
  image: string;
  template?: string;
  evaluationBundle?: ScoringInputSource;
  submission: ScoringInputSource;
  mount?: ScoringMountConfig;
  submissionContract?: SubmissionContractOutput;
  evaluationContract?: CsvTableEvaluationContractOutput;
  metric?: string;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
  env?: Record<string, string>;
  timeoutMs?: number;
  limits?: RunScorerInput["limits"];
  keepWorkspace?: boolean;
  /** When true, pull failures are fatal even if the image exists locally. */
  strictPull?: boolean;
  phaseObserver?: ScoringPipelinePhaseObserver;
}

export interface ScoringPipelineResult {
  result: RunnerScoreResult;
  workspaceRoot: string;
  inputDir: string;
  evaluationBundlePath?: string;
  submissionPath: string;
  runtimeConfigPath: string;
  inputPaths: string[];
  cleanup: () => Promise<void>;
}

export interface ScoringSpecRuntimeConfig {
  env?: Record<string, string>;
  submissionContract?: SubmissionContractOutput;
  evaluationContract?: CsvTableEvaluationContractOutput;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
}

export interface ResolveScoringRuntimeConfigInput {
  env?: Record<string, string> | null;
  submissionContract?: SubmissionContractOutput | null;
  evaluationContract?: CsvTableEvaluationContractOutput | null;
  policies?: Partial<ScorerRuntimePoliciesOutput> | null;
  specCid?: string | null;
  onLegacyFallback?: (specCid: string) => void | Promise<void>;
}

interface ScoringMountPlan {
  evaluationBundlePath?: string;
  submissionPath: string;
  runtimeConfigPath: string;
}

function buildScoringMountPlan(
  mount: ScoringMountConfig,
  inputDir: string,
): ScoringMountPlan {
  return {
    ...(mount.evaluationBundleName
      ? {
          evaluationBundlePath: path.join(inputDir, mount.evaluationBundleName),
        }
      : {}),
    submissionPath: path.join(inputDir, mount.submissionFileName),
    runtimeConfigPath: path.join(inputDir, SCORER_RUNTIME_CONFIG_FILE_NAME),
  };
}

export async function resolveScoringSpecRuntimeConfigFromSpecCid(
  specCid?: string | null,
): Promise<ScoringSpecRuntimeConfig> {
  if (!specCid) {
    return {};
  }
  try {
    const spec = challengeSpecSchema.parse(
      parseChallengeSpecDocument(await getText(specCid)),
    );
    const evalPlan = resolvePinnedChallengeExecution(spec);
    return {
      env: resolveScoringEnvironmentFromSpec(spec),
      submissionContract: spec.submission_contract,
      evaluationContract: spec.execution.evaluation_contract,
      policies: evalPlan.execution.policies,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load challenge spec ${specCid} for scorer configuration. Next step: confirm the spec CID is pinned and reachable. ${message}`,
    );
  }
}

export function resolveTrustedScoringRuntimeConfig(
  input: Omit<ResolveScoringRuntimeConfigInput, "specCid" | "onLegacyFallback">,
): ScoringSpecRuntimeConfig {
  return {
    env: input.env ?? undefined,
    submissionContract: input.submissionContract ?? undefined,
    evaluationContract: input.evaluationContract ?? undefined,
    policies: input.policies ?? undefined,
  };
}

export async function resolveLocalScoringRuntimeConfig(
  input: ResolveScoringRuntimeConfigInput,
): Promise<ScoringSpecRuntimeConfig> {
  const resolved = resolveTrustedScoringRuntimeConfig(input);

  const needsEnv = resolved.env === undefined;
  const needsSubmissionContract = resolved.submissionContract === undefined;
  const needsEvaluationContract = resolved.evaluationContract === undefined;
  const needsPolicies = resolved.policies === undefined;
  if (
    (!needsEnv &&
      !needsSubmissionContract &&
      !needsEvaluationContract &&
      !needsPolicies) ||
    !input.specCid
  ) {
    return resolved;
  }

  await input.onLegacyFallback?.(input.specCid);
  const legacy = await resolveScoringSpecRuntimeConfigFromSpecCid(
    input.specCid,
  );
  return {
    env: resolved.env ?? legacy.env,
    submissionContract:
      resolved.submissionContract ?? legacy.submissionContract,
    evaluationContract:
      resolved.evaluationContract ?? legacy.evaluationContract,
    policies: resolved.policies ?? legacy.policies,
  };
}

export async function resolveScoringRuntimeConfig(
  input: ResolveScoringRuntimeConfigInput,
): Promise<ScoringSpecRuntimeConfig> {
  return resolveLocalScoringRuntimeConfig(input);
}

async function stageSourceToPath(
  source: ScoringInputSource,
  destinationPath: string,
) {
  const hasCid = typeof source.cid === "string" && source.cid.length > 0;
  const hasLocalPath =
    typeof source.localPath === "string" && source.localPath.length > 0;
  const hasContent =
    typeof source.content === "string" && source.content.length > 0;
  const hasBytes =
    source.bytes instanceof Uint8Array && source.bytes.byteLength > 0;
  const sourceCount = [hasCid, hasLocalPath, hasContent, hasBytes].filter(
    Boolean,
  ).length;

  if (sourceCount !== 1) {
    throw new Error(
      "Scoring input source must provide exactly one of: cid, localPath, content, bytes.",
    );
  }

  if (hasCid) {
    await downloadToPath(source.cid as string, destinationPath);
    return;
  }

  if (hasLocalPath) {
    const content = await fs.readFile(path.resolve(source.localPath as string));
    await fs.writeFile(destinationPath, content);
    return;
  }

  if (hasBytes) {
    await fs.writeFile(destinationPath, source.bytes as Uint8Array);
    return;
  }

  await fs.writeFile(destinationPath, source.content as string, "utf8");
}

async function runObservedPhase<T>(
  observer: ScoringPipelinePhaseObserver | undefined,
  phase: ScoringPipelinePhase,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  await observer?.onPhaseStart?.(phase);
  try {
    const result = await fn();
    await observer?.onPhaseSuccess?.(phase, Date.now() - startedAt);
    return result;
  } catch (error) {
    await observer?.onPhaseError?.(phase, Date.now() - startedAt, error);
    throw error;
  }
}

export async function executeScoringPipeline(
  input: ExecuteScoringPipelineInput,
): Promise<ScoringPipelineResult> {
  const workspace = await createScoringWorkspace();
  let done = false;

  const cleanup = async () => {
    if (done) return;
    done = true;
    await cleanupWorkspace(workspace.root);
  };

  try {
    const { evaluationBundlePath, submissionPath, runtimeConfigPath } =
      await runObservedPhase(input.phaseObserver, "fetch_inputs", async () => {
        const stagingPlan = buildScoringMountPlan(
          input.mount ?? DEFAULT_SCORER_MOUNT,
          workspace.inputDir,
        );
        const evaluationBundlePath = input.evaluationBundle
          ? stagingPlan.evaluationBundlePath
          : undefined;
        if (evaluationBundlePath && input.evaluationBundle) {
          await stageSourceToPath(input.evaluationBundle, evaluationBundlePath);
        }

        await stageSourceToPath(input.submission, stagingPlan.submissionPath);
        const runtimeConfig = buildScorerRuntimeConfig({
          template: input.template,
          metric: input.metric,
          mount: input.mount ?? DEFAULT_SCORER_MOUNT,
          submissionContract: input.submissionContract,
          evaluationContract: input.evaluationContract,
          policies: input.policies,
        });
        await fs.writeFile(
          stagingPlan.runtimeConfigPath,
          JSON.stringify(runtimeConfig, null, 2),
          "utf8",
        );
        return {
          evaluationBundlePath,
          submissionPath: stagingPlan.submissionPath,
          runtimeConfigPath: stagingPlan.runtimeConfigPath,
        };
      });

    if (input.submissionContract) {
      const submissionBytes = await fs.readFile(submissionPath);
      const validation = validateSubmissionBytesAgainstContract(
        submissionBytes,
        input.submissionContract,
      );
      if (!validation.valid) {
        const output: ScoringPipelineResult = {
          result: {
            ok: false,
            score: 0,
            error:
              validation.message ??
              "Submission does not match the challenge submission contract.",
            details: {},
            log: "",
            outputPath: path.join(workspace.root, "output", "score.json"),
            containerImageDigest: "",
          },
          workspaceRoot: workspace.root,
          inputDir: workspace.inputDir,
          evaluationBundlePath,
          submissionPath,
          runtimeConfigPath,
          inputPaths: [
            evaluationBundlePath,
            submissionPath,
            runtimeConfigPath,
          ].filter((value): value is string => typeof value === "string"),
          cleanup,
        };

        if (!input.keepWorkspace) {
          await cleanup();
        }

        return output;
      }
    }

    const result = await runObservedPhase(
      input.phaseObserver,
      "run_scorer",
      async () =>
        executeScorer({
          image: input.image,
          inputDir: workspace.inputDir,
          env: input.env,
          timeoutMs: input.timeoutMs,
          limits: input.limits,
          strictPull: input.strictPull,
        }),
    );

    const output: ScoringPipelineResult = {
      result,
      workspaceRoot: workspace.root,
      inputDir: workspace.inputDir,
      evaluationBundlePath,
      submissionPath,
      runtimeConfigPath,
      inputPaths: [
        evaluationBundlePath,
        submissionPath,
        runtimeConfigPath,
      ].filter((value): value is string => typeof value === "string"),
      cleanup,
    };

    if (!input.keepWorkspace) {
      await cleanup();
    }

    return output;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
