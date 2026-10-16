import "server-only";

import {
  collectAll,
  emptySummary,
  inspectResponse,
  SubhubApiError,
  UnrecognizedCollectionError,
  type PageQuery,
  type ResponseSummary,
} from "./body";
import {
  ApiSession,
  AuthRejectedError,
  connectionIntent,
  readApiAuthConfig,
  type AuthModeName,
  type ConnectionReport,
} from "./session";
import type { ApiOrg, ApiProject } from "./types";

export { SubhubApiError };

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

export function resetApiSession(): void {
  session = null;
  sessionFingerprint = "";
}

function configuredSecrets(): string[] {
  const config = readApiAuthConfig(process.env);
  return [config.apiKey, config.password].filter((value) => value.length >= 3);
}

async function readPayload(
  path: string,
  search?: Record<string, string | number | undefined>,
): Promise<{ payload: unknown; summary: ResponseSummary; status: number }> {
  let response: Response;
  try {
    ({ response } = await currentSession().request(path, search));
  } catch (error) {
    if (error instanceof AuthRejectedError) throw new SubhubApiError(401, path, emptySummary("credentials rejected"));
    throw error;
  }
  const text = await response.text();
  const { summary, payload } = inspectResponse(response.headers.get("content-type"), text, configuredSecrets());
  if (!response.ok || (response.status >= 300 && response.status < 400) || summary.bodyKind !== "json" || payload === null) {
    throw new SubhubApiError(response.status, path, summary);
  }
  return { payload, summary, status: response.status };
}

export async function fetchAllPages<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const last: { summary?: ResponseSummary; status?: number } = {};
  try {
    return await collectAll<T>(async (query: PageQuery) => {
      const read = await readPayload(path, { ...params, limit: 50, cursor: query.cursor, page: query.page });
      last.summary = read.summary;
      last.status = read.status;
      return read.payload;
    });
  } catch (error) {
    if (error instanceof UnrecognizedCollectionError && last.summary && last.status) {
      throw new SubhubApiError(last.status, path, last.summary);
    }
    throw error;
  }
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
