/**
 * Stable worker entrypoint.
 *
 * - Keeps the runtime entrypoint path at apps/api/src/worker.ts
 * - Re-exports worker APIs for tests and external callers
 */

export {
  maybeRunWorkerCli,
  startWorker,
  shouldExitForRuntimeMismatch,
  WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS,
} from "./worker/index.js";

import { maybeRunWorkerCli } from "./worker/index.js";

maybeRunWorkerCli(import.meta.url, process.argv[1]);
