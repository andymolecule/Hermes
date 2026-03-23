// Testing mode: keep write limits disabled during fast iteration.
// Next step before production: re-enable limits and tune per-route caps.
const WRITE_LIMITS_ENABLED = false;
const DEFAULT_WRITE_LIMIT = 5;
const ROUTE_WRITE_LIMITS: Record<string, number> = {
  "/api/authoring/uploads": 20,
};
const WRITE_WINDOW_MS = 60 * 60 * 1000;
const GC_INTERVAL_MS = 10 * 60 * 1000;

const writeBuckets = new Map<string, { count: number; resetAt: number }>();

// Prevent unbounded memory growth from expired buckets
const gcTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of writeBuckets) {
    if (bucket.resetAt <= now) writeBuckets.delete(key);
  }
}, GC_INTERVAL_MS);
gcTimer.unref();

export function consumeWriteQuota(address: string, routeKey: string) {
  if (!WRITE_LIMITS_ENABLED) {
    return { allowed: true } as const;
  }

  const key = `${address}:${routeKey}`;
  const limit = ROUTE_WRITE_LIMITS[routeKey] ?? DEFAULT_WRITE_LIMIT;
  const now = Date.now();
  const current = writeBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + WRITE_WINDOW_MS }
      : current;

  if (bucket.count >= limit) {
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
    return {
      allowed: false,
      retryAfterSec,
      message: `Rate limit exceeded: max ${limit} write requests per hour. Retry after ${retryAfterSec}s.`,
    };
  }

  bucket.count += 1;
  writeBuckets.set(key, bucket);
  return { allowed: true } as const;
}
