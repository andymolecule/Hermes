/**
 * Stable worker entrypoint.
 *
 * - Keeps the runtime entrypoint path at apps/api/src/worker.ts
 * - Re-exports worker APIs for tests and external callers
 */

export {
  maybeRunWorkerCli,
  resolveRunnerPolicyForChallenge,
  startWorker,
  type ResolvedRunnerPolicy,
} from "./worker/index.js";

import { maybeRunWorkerCli } from "./worker/index.js";

maybeRunWorkerCli(import.meta.url, process.argv[1]);
