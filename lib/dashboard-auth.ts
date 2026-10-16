import { safeEqual, sessionToken } from "./auth-token";

/** Same dashboard session as the middleware gate on /sync. */
export async function dashboardAuthorized(request: Request): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return true;
  const cookie = readCookie(request.headers.get("cookie"), "cxm_session");
  if (!cookie) return false;
  return safeEqual(cookie, await sessionToken(password));
}

export function readCookie(header: string | null, name: string): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}
