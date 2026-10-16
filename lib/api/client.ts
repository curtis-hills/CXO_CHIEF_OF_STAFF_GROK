import "server-only";

import {
  ApiSession,
  AuthRejectedError,
  connectionIntent,
  readApiAuthConfig,
  type AuthModeName,
  type ConnectionReport,
} from "./session";
import type { ApiOrg, ApiProject, CursorPage } from "./types";

export class SubhubApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string) {
    super(`SubcontractorHub API ${path} returned ${status}`);
    this.name = "SubhubApiError";
    this.status = status;
    this.path = path;
  }
}

let session: ApiSession | null = null;
let sessionFingerprint = "";

function currentSession(): ApiSession {
  const config = readApiAuthConfig(process.env);
  const fingerprint = [
    config.baseUrl,
    config.mode,
    config.keyHeader,
    config.loginPath,
    config.loginUsernameField,
    config.loginPasswordField,
    config.loginKeyField,
    config.loginDeviceName,
    config.apiKey,
    config.username,
    config.password,
  ].join("\u0000");
  if (!session || sessionFingerprint !== fingerprint) {
    session = new ApiSession(config, fetch);
    sessionFingerprint = fingerprint;
  }
  return session;
}

export function getApiConfig(): { baseUrl: string; live: boolean; mode: AuthModeName | "auto" | "demo" } {
  const config = readApiAuthConfig(process.env);
  const intent = connectionIntent(config);
  return {
    baseUrl: config.baseUrl,
    live: intent === "ready",
    mode: intent === "ready" ? config.mode : "demo",
  };
}

export async function checkApiConnection(): Promise<ConnectionReport> {
  return currentSession().probe();
}

async function shGet<T>(path: string, search?: Record<string, string | number | undefined>): Promise<T> {
  let response: Response;
  try {
    ({ response } = await currentSession().request(path, search));
  } catch (error) {
    if (error instanceof AuthRejectedError) throw new SubhubApiError(401, path);
    throw error;
  }
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    await response.arrayBuffer().catch(() => undefined);
    throw new SubhubApiError(response.status, path);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new SubhubApiError(response.status, path);
  }
}

export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 40; page += 1) {
    const body = await shGet<CursorPage<T>>(path, { ...params, limit: 50, cursor });
    items.push(...(body.results?.data ?? []));
    const next = body.results?.next_cursor ?? undefined;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return items;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  }
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function fetchOrgs(): Promise<ApiOrg[]> {
  return fetchAllPages<ApiOrg>("/api/v1/superadmin/orgs");
}

export async function fetchProjectsByOrg(orgIds: string[]): Promise<Record<string, ApiProject[]>> {
  const rows = await mapPool(orgIds, 3, async (orgId) => {
    const projects = await fetchAllPages<ApiProject>("/api/v1/superadmin/projects", { org_id: orgId });
    return [orgId, projects] as const;
  });
  return Object.fromEntries(rows);
}
