import type { ConnectionReport } from "./session";

/** JSON Curtis can paste from /api/health. Credentials are never included. */
export function healthPayload(report: ConnectionReport): Record<string, unknown> {
  const payload: Record<string, unknown> = { status: report.status };
  if (report.mode) payload.mode = report.mode;
  if (typeof report.upstreamStatus === "number") payload.upstreamStatus = report.upstreamStatus;
  if (report.contentType) payload.contentType = report.contentType;
  if (report.bodyKind) payload.bodyKind = report.bodyKind;
  if (report.topLevelKeys) payload.topLevelKeys = report.topLevelKeys;
  if (report.bodyKind) payload.recordCount = report.recordCount ?? null;
  if (report.detail) payload.detail = report.detail;
  if (report.loginPath) payload.loginPath = report.loginPath;
  if (report.loginAttempts && report.loginAttempts.length > 0) payload.loginAttempts = report.loginAttempts;
  return payload;
}
