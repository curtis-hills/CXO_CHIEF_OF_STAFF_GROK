/**
 * Shared caps for the superadmin crawl. Health uses the same page size as the dashboard.
 * The API rejects `limit` above 50. Forty pages of 50 cover 2000 rows; the crawl follows
 * `next_cursor` until it is absent and stops at this cap.
 */
export const PAGE_SIZE = 50;
export const MAX_PAGES = 40;
export const REQUEST_TIMEOUT_MS = 15_000;
/** In-process portfolio cache. Next.js revalidate matches it. A failed refresh keeps the last snapshot. */
export const PORTFOLIO_TTL_MS = 30 * 60 * 1000;
export const PORTFOLIO_REVALIDATE_SECONDS = 1800;
/** After a failed refresh, wait this long before trying the API again. */
export const STALE_RETRY_MS = 60_000;
