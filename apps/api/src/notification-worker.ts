/**
 * Stable notification worker entrypoint.
 */

export {
  maybeRunNotificationWorkerCli,
  startNotificationWorker,
} from "./worker/notifications.js";

import { maybeRunNotificationWorkerCli } from "./worker/notifications.js";

maybeRunNotificationWorkerCli(import.meta.url, process.argv[1]);
