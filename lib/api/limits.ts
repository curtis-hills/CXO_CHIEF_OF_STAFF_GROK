/**
 * Shared caps for the superadmin crawl. Health uses the same page size as the dashboard.
 * The API rejects `limit` above 50. Forty pages of 50 cover 2000 rows; the crawl follows
 * `next_cursor` until it is absent and stops at this cap.
 */
export const PAGE_SIZE = 50;
export const MAX_PAGES = 40;
export const REQUEST_TIMEOUT_MS = 15_000;
export const PROJECT_FETCH_CONCURRENCY = 8;
/** In-process portfolio cache. Next.js revalidate is a little longer so a new instance can reuse it. */
export const PORTFOLIO_TTL_MS = 12 * 60 * 1000;
export const PORTFOLIO_REVALIDATE_SECONDS = 900;
