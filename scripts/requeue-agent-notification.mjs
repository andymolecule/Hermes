import {
  createSupabaseClient,
  requeueAgentNotification,
} from "../packages/db/src/index.ts";

function readFlag(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find((arg) => arg.startsWith(prefix))
    ?.slice(prefix.length);
}

const notificationId = readFlag("notification-id");
const delayMs = Number(readFlag("delay-ms") ?? "0");
const keepAttempts = process.argv.includes("--keep-attempts");

if (!notificationId) {
  throw new Error(
    "notification-id is required. Next step: pass --notification-id=<uuid> and retry.",
  );
}

if (!Number.isFinite(delayMs) || delayMs < 0) {
  throw new Error(
    "delay-ms must be a non-negative number. Next step: pass --delay-ms=<milliseconds> and retry.",
  );
}

const db = createSupabaseClient(true);
const row = await requeueAgentNotification(db, {
  notificationId,
  delayMs,
  resetAttempts: !keepAttempts,
});

if (!row) {
  throw new Error(
    `Notification ${notificationId} was not found. Next step: verify the notification id and retry.`,
  );
}

console.log(
  JSON.stringify(
    {
      notificationId: row.id,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      resetAttempts: !keepAttempts,
    },
    null,
    2,
  ),
);
