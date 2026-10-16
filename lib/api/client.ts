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
import { PAGE_SIZE } from "./limits";
import type { ApiOrg, ApiProject } from "./types";
import { clearLiveInputsCache } from "../data/live-cache";

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
  clearLiveInputsCache();
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
      const read = await readPayload(path, { ...params, limit: PAGE_SIZE, cursor: query.cursor, page: query.page });
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

export async function fetchOrgs(): Promise<ApiOrg[]> {
  return fetchAllPages<ApiOrg>("/api/v1/superadmin/orgs");
}

export async function fetchProjectsByOrg(orgIds: string[]): Promise<Record<string, ApiProject[]>> {
  if (orgIds.length === 0) return {};
  try {
    const projects = await fetchAllPages<ApiProject>("/api/v1/superadmin/projects");
    if (projects.length > 0) {
      const grouped = groupProjects(orgIds, projects);
      if (grouped) return grouped;
    }
  } catch (error) {
    if (!shouldFetchProjectsPerOrg(error)) throw error;
  }
  return fetchProjectsPerOrg(orgIds);
}

/** One org at a time. A parallel fan-out trips the Laravel throttle. */
async function fetchProjectsPerOrg(orgIds: string[]): Promise<Record<string, ApiProject[]>> {
  const grouped: Record<string, ApiProject[]> = {};
  for (const orgId of orgIds) {
    grouped[orgId] = await fetchAllPages<ApiProject>("/api/v1/superadmin/projects", { org_id: orgId });
  }
  return grouped;
}

function groupProjects(orgIds: string[], projects: ApiProject[]): Record<string, ApiProject[]> | null {
  const grouped: Record<string, ApiProject[]> = Object.fromEntries(orgIds.map((id) => [id, [] as ApiProject[]]));
  let tagged = 0;
  for (const project of projects) {
    const orgId = projectOrgId(project);
    if (!orgId) continue;
    tagged += 1;
    if (!grouped[orgId]) grouped[orgId] = [];
    grouped[orgId].push(project);
  }
  return tagged > 0 ? grouped : null;
}

function projectOrgId(project: ApiProject): string | null {
  const record = project as ApiProject & {
    org_id?: string | number | null;
    organization_id?: string | number | null;
    org?: { id?: string | number | null } | null;
  };
  const direct = record.org_id ?? record.organization_id ?? record.org?.id;
  if (typeof direct === "string" || typeof direct === "number") return String(direct);
  return null;
}

function shouldFetchProjectsPerOrg(error: unknown): boolean {
  if (!(error instanceof SubhubApiError)) return false;
  if (error.status === 401 || error.status === 403 || error.status === 429) return false;
  if (error.bodyKind === "html") return false;
  return true;
}
