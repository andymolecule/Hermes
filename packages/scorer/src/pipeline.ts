import fs from "node:fs/promises";
import path from "node:path";
import {
  type SubmissionContractOutput,
  challengeSpecSchema,
  resolveScoringEnvironmentFromSpec,
  validateSubmissionBytesAgainstContract,
} from "@agora/common";
import { downloadToPath } from "@agora/ipfs";
import { getJSON } from "@agora/ipfs";
import {
  type RunScorerInput,
  type RunnerScoreResult,
  runScorer,
} from "./runner.js";
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
  evaluationBundle?: ScoringInputSource;
  submission: ScoringInputSource;
  submissionContract?: SubmissionContractOutput;
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
  inputPaths: string[];
  cleanup: () => Promise<void>;
}

export interface ScoringSpecRuntimeConfig {
  env?: Record<string, string>;
  submissionContract?: SubmissionContractOutput;
}

export async function resolveScoringSpecRuntimeConfigFromSpecCid(
  specCid?: string | null,
): Promise<ScoringSpecRuntimeConfig> {
  if (!specCid) {
    return {};
  }
  try {
    const spec = challengeSpecSchema.parse(await getJSON(specCid));
    return {
      env: resolveScoringEnvironmentFromSpec(spec),
      submissionContract: spec.submission_contract,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to load challenge spec ${specCid} for scorer configuration. Next step: confirm the spec CID is pinned and reachable. ${message}`,
    );
  }
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
    const { evaluationBundlePath, submissionPath } = await runObservedPhase(
      input.phaseObserver,
      "fetch_inputs",
      async () => {
        // Current scorer family still expects the evaluation bundle staged
        // under the historical ground_truth.csv filename.
        const evaluationBundlePath = input.evaluationBundle
          ? path.join(workspace.inputDir, "ground_truth.csv")
          : undefined;
        if (evaluationBundlePath && input.evaluationBundle) {
          await stageSourceToPath(input.evaluationBundle, evaluationBundlePath);
        }

        const submissionPath = path.join(workspace.inputDir, "submission.csv");
        await stageSourceToPath(input.submission, submissionPath);
        return { evaluationBundlePath, submissionPath };
      },
    );

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
          inputPaths: [evaluationBundlePath, submissionPath].filter(
            (value): value is string => typeof value === "string",
          ),
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
        runScorer({
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
      inputPaths: [evaluationBundlePath, submissionPath].filter(
        (value): value is string => typeof value === "string",
      ),
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
