type Bucket = { tokens: number; updatedAt: number };

// Map iteration order = least recently updated first (entries are re-inserted on use).
const buckets = new Map<string, Bucket>();
let maxBuckets = 10_000;

/** In-memory token bucket (single local process, D-008). Returns true if allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  const bucket = existing ?? { tokens: limit, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / windowMs) * limit;
  bucket.tokens = Math.min(limit, bucket.tokens + refill);
  bucket.updatedAt = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  if (existing) buckets.delete(key);
  buckets.set(key, bucket);
  // Evict the oldest entries only; never clear everything.
  while (buckets.size > maxBuckets) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
  return allowed;
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function setMaxBucketsForTests(n: number): void {
  maxBuckets = n;
}

/** Client identity. X-Forwarded-For is only honoured when SQLLENS_TRUST_PROXY=1. */
export function clientKey(request: Request): string {
  if (process.env.SQLLENS_TRUST_PROXY === "1") {
    const fwd = request.headers.get("x-forwarded-for");
    const first = fwd?.split(",")[0].trim();
    if (first) return first;
  }
  return "local";
}

/** Login limits: per IP (5/min), per username (5/min), global (20/min). */
export function loginAllowed(request: Request, username: unknown): boolean {
  const ip = rateLimit(`login:ip:${clientKey(request)}`, 5, 60_000);
  const global = rateLimit("login:global", 20, 60_000);
  const user =
    typeof username === "string"
      ? rateLimit(`login:user:${username.trim().toLowerCase().slice(0, 256)}`, 5, 60_000)
      : true;
  return ip && global && user;
}
