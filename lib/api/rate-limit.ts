import { redactSecrets } from "./body";

/** How many times to retry one request after a 429, in addition to the first attempt. */
export const MAX_RATE_LIMIT_RETRIES = 4;
const WAIT_CAP_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 30_000;

export type RateLimitSnapshot = {
  retryAfter: string | null;
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  status: number;
};

export function readRateLimitHeaders(headers: Headers, status: number, secrets: string[] = []): RateLimitSnapshot | null {
  const retryAfter = safeHeader(headers.get("retry-after"), secrets);
  const limit = safeHeader(headers.get("x-ratelimit-limit"), secrets);
  const remaining = safeHeader(headers.get("x-ratelimit-remaining"), secrets);
  const reset = safeHeader(headers.get("x-ratelimit-reset"), secrets);
  if (!retryAfter && !limit && !remaining && !reset) return null;
  return { retryAfter, limit, remaining, reset, status };
}

/**
 * Wait for Retry-After, otherwise until X-RateLimit-Reset, otherwise exponential backoff with jitter.
 * `attempt` is 1 for the first retry.
 */
export function retryDelayMs(headers: Headers, attempt: number, now = Date.now(), random: () => number = Math.random): number {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    if (/^\d+(\.\d+)?$/.test(retryAfter)) return cap(Number(retryAfter) * 1000);
    const parsed = Date.parse(retryAfter);
    if (Number.isFinite(parsed)) return cap(parsed - now);
  }
  const reset = headers.get("x-ratelimit-reset")?.trim();
  if (reset && /^\d+(\.\d+)?$/.test(reset)) {
    const value = Number(reset);
    const at = value >= 1e12 ? value : value >= 1e9 ? value * 1000 : now + value * 1000;
    return cap(at - now);
  }
  const exponential = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(random() * Math.min(250, exponential));
  return cap(exponential + jitter);
}

function cap(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(WAIT_CAP_MS, ms);
}

function safeHeader(value: string | null, secrets: string[]): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80 || /[\r\n]/.test(trimmed)) return null;
  if (!/^[A-Za-z0-9 .:+_-]+$/.test(trimmed)) return null;
  const redacted = redactSecrets(trimmed, secrets);
  return redacted || null;
}
