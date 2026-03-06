import fs from "node:fs/promises";
import path from "node:path";
import { downloadToPath } from "@hermes/ipfs";
import {
  runScorer,
  type RunScorerInput,
  type RunnerScoreResult,
} from "./runner.js";
import { cleanupWorkspace, createScoringWorkspace } from "./staging.js";

export interface ScoringInputSource {
  cid?: string;
  localPath?: string;
  content?: string;
}

export interface ExecuteScoringPipelineInput {
  image: string;
  evaluationBundle?: ScoringInputSource;
  submission: ScoringInputSource;
  timeoutMs?: number;
  limits?: RunScorerInput["limits"];
  keepWorkspace?: boolean;
  /** When true, pull failures are fatal even if the image exists locally. */
  strictPull?: boolean;
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

async function stageSourceToPath(
  source: ScoringInputSource,
  destinationPath: string,
) {
  const hasCid = typeof source.cid === "string" && source.cid.length > 0;
  const hasLocalPath =
    typeof source.localPath === "string" && source.localPath.length > 0;
  const hasContent =
    typeof source.content === "string" && source.content.length > 0;
  const sourceCount = [hasCid, hasLocalPath, hasContent].filter(Boolean).length;

  if (sourceCount !== 1) {
    throw new Error(
      "Scoring input source must provide exactly one of: cid, localPath, content.",
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

  await fs.writeFile(destinationPath, source.content as string, "utf8");
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

    const result = await runScorer({
      image: input.image,
      inputDir: workspace.inputDir,
      timeoutMs: input.timeoutMs,
      limits: input.limits,
      strictPull: input.strictPull,
    });

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
