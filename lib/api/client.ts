import "server-only";

import type { ApiOrg, ApiProject, CursorPage } from "./types";

const DEFAULT_BASE = "https://api.virtualsaleportal.com";

export function getApiConfig(): { apiKey: string; baseUrl: string; live: boolean } {
  const apiKey = process.env.SUBHUB_API_KEY?.trim() ?? "";
  const configured = process.env.SUBHUB_API_BASE_URL?.trim() || DEFAULT_BASE;
  const baseUrl = configured.replace(/\/$/, "");
  return { apiKey, baseUrl, live: apiKey.length > 0 };
}

export class SubhubApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string) {
    super(`SubcontractorHub API returned ${status} for ${path}`);
    this.name = "SubhubApiError";
    this.status = status;
    this.path = path;
  }
}

export async function shGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const { apiKey, baseUrl, live } = getApiConfig();
  if (!live) {
    throw new Error("SUBHUB_API_KEY is not set");
  }

  const url = new URL(path.startsWith("/") ? path : `/${path}`, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
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
      results[index] = await fn(items[index], index);
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
