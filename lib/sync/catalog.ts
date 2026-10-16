/**
 * Superadmin lists the sync walks. Orgs and projects are required.
 * Financials, e-sign, and commissions use the paths below. A 404 marks that
 * endpoint unsupported instead of failing the org backfill.
 *
 * Incremental filters are not part of the documented API. The job probes them
 * and records a 422 as unsupported. Until Ashish adds updated_since, a daily
 * run uses a newest-first sort when the API accepts one, and Sundays do a full
 * reconcile.
 */
export const FILTER_PARAMS = ["updated_since", "updated_after", "from", "updated_at_from"] as const;
export const SORT_PARAMS = ["-updated_at", "-created_at"] as const;

export type FilterParam = (typeof FILTER_PARAMS)[number];
export type SortParam = (typeof SORT_PARAMS)[number];

export const ENDPOINTS = [
  { id: "orgs", path: "/api/v1/superadmin/orgs", required: true },
  { id: "projects", path: "/api/v1/superadmin/projects", required: true },
  { id: "financials", path: "/api/v1/superadmin/financials", required: false },
  { id: "esign_status", path: "/api/v1/superadmin/esign-status", required: false },
  { id: "commissions", path: "/api/v1/superadmin/commissions", required: false },
] as const;

export type EndpointId = (typeof ENDPOINTS)[number]["id"];

export function endpointById(id: EndpointId): (typeof ENDPOINTS)[number] {
  const found = ENDPOINTS.find((endpoint) => endpoint.id === id);
  if (!found) throw new Error(`Unknown sync endpoint ${id}`);
  return found;
}

export const INCREMENTAL_GAP_NOTE =
  "The documented superadmin lists have no updated_since, updated_after, from, or updated_at_from filter, and no sort=-updated_at. The sync probes those query params. A 422 marks one unsupported. Ask Ashish for updated_since on every superadmin endpoint. Until then, daily sync crawls newest-first when a sort is accepted and stops at the high-water mark. If no sort is accepted, the daily job does not re-walk the full history; Sunday runs a full reconcile.";
