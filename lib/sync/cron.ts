import { safeEqual } from "../auth-token";

/** Vercel Cron sends Authorization: Bearer $CRON_SECRET. A missing secret rejects the route. */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return safeEqual(header, `Bearer ${secret}`);
}
