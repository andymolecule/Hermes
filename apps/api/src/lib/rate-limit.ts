const WRITE_LIMIT = 5;
const WRITE_WINDOW_MS = 60 * 60 * 1000;

const writeBuckets = new Map<string, { count: number; resetAt: number }>();

export function consumeWriteQuota(address: string, routeKey: string) {
  const key = `${address}:${routeKey}`;
  const now = Date.now();
  const current = writeBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + WRITE_WINDOW_MS }
      : current;

  if (bucket.count >= WRITE_LIMIT) {
    return {
      allowed: false,
      message: "Rate limit exceeded: max 5 write requests per hour.",
    };
  }

  bucket.count += 1;
  writeBuckets.set(key, bucket);
  return { allowed: true } as const;
}
