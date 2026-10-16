/**
 * Read-only profile of the synced SubcontractorHub tables.
 * Every statement is a single SELECT. The loader rejects anything else.
 */

export const PROFILE_TABLES = [
  "orgs",
  "org_subscriptions",
  "projects",
  "financials",
  "esign_status",
  "commissions",
] as const;

export type ProfileTable = (typeof PROFILE_TABLES)[number];

/** Substring match for fields a CXO would filter on. */
export const CATEGORICAL_KEY_SQL = "type|status|role|plan|active|is_test|parent|office|sub_org";

/** Keys whose values are contact data. Counted, never listed. */
export const CONTACT_KEY_SQL = "email|e_mail|e-mail|phone|mobile|fax|telephone";

/**
 * Top-level key that can point a project at an org.
 * Anchored so `organization_name` is not treated as an id.
 */
export const ORG_LINK_KEY_SQL = "(^|_)(org|organization|organisation|office)(_id)?$";

const CHILD_TABLES = ["commissions", "esign_status", "financials"] as const;

export const KNOWN_LINK_ROUTES = [
  "projects.org_id",
  "projects.raw.org_id",
  "projects.raw.organization_id",
  "projects.raw.org",
  "projects.raw.organization",
  "projects.raw.organisation_id",
  "projects.raw.organisation",
  "projects.raw.parent_org_id",
  "projects.raw.parent_organization_id",
  "projects.raw.sub_org_id",
  "projects.raw.sub_org",
  "projects.raw.office_id",
  "projects.raw.office",
  "commissions.org_id+project_id",
  "commissions.raw.organization_id+project_id",
  "commissions.raw.org_id+project_id",
  "commissions.raw.org+project_id",
  "commissions.raw.organization+project_id",
  "esign_status.org_id+project_id",
  "esign_status.raw.organization_id+project_id",
  "esign_status.raw.org_id+project_id",
  "esign_status.raw.org+project_id",
  "esign_status.raw.organization+project_id",
  "financials.org_id+project_id",
  "financials.raw.organization_id+project_id",
  "financials.raw.org_id+project_id",
  "financials.raw.org+project_id",
  "financials.raw.organization+project_id",
] as const;

const ROUTE_LABELS: Record<string, string> = {
  "projects.org_id": "projects.org_id column matches orgs.id",
  "projects.raw.org_id": "projects raw org_id matches orgs.id",
  "projects.raw.organization_id": "projects raw organization_id matches orgs.id",
  "projects.raw.org": "projects raw org, using a scalar id or org.id",
  "projects.raw.organization": "projects raw organization, using a scalar id or organization.id",
  "projects.raw.organisation_id": "projects raw organisation_id matches orgs.id",
  "projects.raw.organisation": "projects raw organisation, using a scalar id or organisation.id",
  "projects.raw.parent_org_id": "projects raw parent_org_id matches orgs.id",
  "projects.raw.parent_organization_id": "projects raw parent_organization_id matches orgs.id",
  "projects.raw.sub_org_id": "projects raw sub_org_id matches orgs.id",
  "projects.raw.sub_org": "projects raw sub_org, using a scalar id or sub_org.id",
  "projects.raw.office_id": "projects raw office_id matches orgs.id",
  "projects.raw.office": "projects raw office, using a scalar id or office.id",
  "commissions.org_id+project_id": "commissions.org_id column joined to projects on project_id",
  "commissions.raw.organization_id+project_id": "commissions.organization_id joined to projects on project_id",
  "commissions.raw.org_id+project_id": "commissions raw org_id joined to projects on project_id",
  "commissions.raw.org+project_id": "commissions raw org joined to projects on project_id",
  "commissions.raw.organization+project_id": "commissions raw organization joined to projects on project_id",
  "esign_status.org_id+project_id": "esign_status.org_id column joined to projects on project_id",
  "esign_status.raw.organization_id+project_id": "esign_status raw organization_id joined to projects on project_id",
  "esign_status.raw.org_id+project_id": "esign_status raw org_id joined to projects on project_id",
  "esign_status.raw.org+project_id": "esign_status raw org joined to projects on project_id",
  "esign_status.raw.organization+project_id": "esign_status raw organization joined to projects on project_id",
  "financials.org_id+project_id": "financials.org_id column joined to projects on project_id",
  "financials.raw.organization_id+project_id": "financials raw organization_id joined to projects on project_id",
  "financials.raw.org_id+project_id": "financials raw org_id joined to projects on project_id",
  "financials.raw.org+project_id": "financials raw org joined to projects on project_id",
  "financials.raw.organization+project_id": "financials raw organization joined to projects on project_id",
};

const WRITE_SQL =
  /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|merge|comment|vacuum|analyze|refresh|call|execute|do|into)\b/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{10,15}\b)|(?:(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b)/g;

const CATEGORICAL_KEY = new RegExp(CATEGORICAL_KEY_SQL, "i");
const CONTACT_KEY = new RegExp(CONTACT_KEY_SQL, "i");
const ORG_LINK_KEY = new RegExp(ORG_LINK_KEY_SQL, "i");

type ColumnKind = "text" | "value";

const QUALITY_COLUMNS: Record<ProfileTable, { name: string; kind: ColumnKind }[]> = {
  orgs: [
    { name: "id", kind: "text" },
    { name: "name", kind: "text" },
    { name: "status", kind: "text" },
    { name: "sub_status", kind: "text" },
    { name: "payment_status", kind: "text" },
    { name: "account_type", kind: "text" },
    { name: "city", kind: "text" },
    { name: "state", kind: "text" },
    { name: "cxm_id", kind: "text" },
    { name: "cxm_name", kind: "text" },
    { name: "ae_id", kind: "text" },
    { name: "ae_name", kind: "text" },
    { name: "active_user_count", kind: "value" },
    { name: "created_at", kind: "value" },
    { name: "updated_at", kind: "value" },
  ],
  org_subscriptions: [
    { name: "id", kind: "text" },
    { name: "org_id", kind: "text" },
    { name: "status", kind: "text" },
    { name: "plan_name", kind: "text" },
    { name: "unit_price", kind: "value" },
    { name: "interval", kind: "text" },
  ],
  projects: [
    { name: "id", kind: "text" },
    { name: "org_id", kind: "text" },
    { name: "job_type", kind: "text" },
    { name: "system_size", kind: "text" },
    { name: "is_test", kind: "value" },
    { name: "deleted_at", kind: "value" },
    { name: "created_at", kind: "value" },
    { name: "updated_at", kind: "value" },
  ],
  financials: [
    { name: "id", kind: "text" },
    { name: "org_id", kind: "text" },
    { name: "project_id", kind: "text" },
    { name: "status", kind: "text" },
    { name: "amount", kind: "value" },
    { name: "created_at", kind: "value" },
    { name: "updated_at", kind: "value" },
  ],
  esign_status: [
    { name: "id", kind: "text" },
    { name: "org_id", kind: "text" },
    { name: "project_id", kind: "text" },
    { name: "status", kind: "text" },
    { name: "created_at", kind: "value" },
    { name: "updated_at", kind: "value" },
  ],
  commissions: [
    { name: "id", kind: "text" },
    { name: "org_id", kind: "text" },
    { name: "project_id", kind: "text" },
    { name: "status", kind: "text" },
    { name: "amount", kind: "value" },
    { name: "created_at", kind: "value" },
    { name: "updated_at", kind: "value" },
  ],
};

export type TableCount = { table: ProfileTable; rows: number };

export type KeyFill = {
  key: string;
  present: number;
  filled: number;
  fillRate: number | null;
};

export type TableKeys = { table: ProfileTable; rows: number; keys: KeyFill[] };

export type CategoricalValue = { value: string; count: number };

export type CategoricalField = {
  table: ProfileTable;
  key: string;
  distinctValues: number;
  truncated: boolean;
  values: CategoricalValue[];
};

export type TestOrg = {
  id: string;
  name: string | null;
  status: string | null;
  accountType: string | null;
  subStatus: string | null;
};

export type IsTestFlag = {
  source: string;
  trueCount: number;
  falseCount: number;
  nullCount: number;
  missingCount: number;
  otherCount: number;
};

export type LinkRoute = {
  route: string;
  label: string;
  projectsWithLink: number;
  projectsMapped: number;
  orgs: number;
};

export type MonthCount = { month: string; projects: number };

export type TopOrg = { id: string; name: string | null; projects: number };

export type QualityColumn = { column: string; nulls: number; nullRate: number | null };

export type QualityTable = {
  table: ProfileTable;
  rows: number;
  duplicateIds: number;
  duplicateRawIds: number;
  rawIdMismatches: number;
  columns: QualityColumn[];
};

export type DuplicateName = { name: string; count: number };

export type DataProfile = {
  notes: string[];
  tables: TableCount[];
  keys: TableKeys[];
  categorical: CategoricalField[];
  testOrgs: { total: number; shown: number; orgs: TestOrg[] };
  isTestFlags: IsTestFlag[];
  linkRoutes: LinkRoute[];
  projectsMapped: number;
  projectsUnmapped: number;
  projectsByMonth: MonthCount[];
  projectsMissingCreatedAt: number;
  topOrgs: TopOrg[];
  orgsWithZeroProjects: number;
  quality: QualityTable[];
  duplicateOrgNames: DuplicateName[];
  duplicateOrgNameGroups: number;
};

export type DataProfileReport = {
  databaseConnected: boolean;
  migrationsApplied: boolean;
  error: string | null;
  generatedAt: string;
  profile: DataProfile | null;
};

export type ProfileDb = {
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export function isContactKey(key: string): boolean {
  return CONTACT_KEY.test(key);
}

export function isCategoricalKey(key: string): boolean {
  if (isContactKey(key)) return false;
  return CATEGORICAL_KEY.test(key);
}

export function isOrgLinkKey(key: string): boolean {
  if (isContactKey(key)) return false;
  return ORG_LINK_KEY.test(key);
}

export function redactContacts(value: string): string {
  return value.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

export function assertSelectOnly(sql: string): void {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
  if (withoutComments.includes(";")) {
    throw new Error("Profile query must be a single statement.");
  }
  if (withoutComments.includes("$$")) {
    throw new Error("Profile query cannot use dollar quotes.");
  }
  const stripped = stripSqlLiterals(withoutComments).trim();
  if (!/^(select|with)\b/i.test(stripped)) {
    throw new Error("Profile query must be a SELECT.");
  }
  if (!/\bselect\b/i.test(stripped)) {
    throw new Error("Profile query must be a SELECT.");
  }
  if (/\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(stripped)) {
    throw new Error("Profile query must not lock rows.");
  }
  if (WRITE_SQL.test(stripped)) {
    throw new Error("Profile query must not write.");
  }
}

function stripSqlLiterals(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''");
}

function asInt(expression: string): string {
  return `(${expression})::int`;
}

function asObject(expression: string): string {
  return `CASE WHEN jsonb_typeof(${expression}) = 'object' THEN ${expression} ELSE '{}'::jsonb END`;
}

function orgRefFromValue(expression: string): string {
  return `CASE
    WHEN jsonb_typeof(${expression}) IN ('string', 'number') THEN NULLIF(btrim(${expression} #>> '{}'), '')
    WHEN jsonb_typeof(${expression}) = 'object' THEN NULLIF(btrim(${expression}->>'id'), '')
    ELSE NULL
  END`;
}

function projectIdExpr(alias: string): string {
  return `COALESCE(
    NULLIF(btrim(${alias}.project_id), ''),
    NULLIF(btrim(${alias}.raw->>'project_id'), ''),
    NULLIF(btrim(${alias}.raw #>> '{project,id}'), '')
  )`;
}

function filledValue(expression: string): string {
  return `jsonb_typeof(${expression}) <> 'null'
    AND ${expression} <> '[]'::jsonb
    AND ${expression} <> '{}'::jsonb
    AND NOT (jsonb_typeof(${expression}) = 'string' AND btrim(${expression} #>> '{}') = '')`;
}

function unionTables(render: (table: ProfileTable) => string): string {
  return PROFILE_TABLES.map((table) => render(table)).join("\nUNION ALL\n");
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const linksCte = `links AS (
  SELECT 'projects.org_id'::text AS route,
         p.id AS project_id,
         NULLIF(btrim(p.org_id), '') AS org_ref
  FROM projects p
  WHERE NULLIF(btrim(p.org_id), '') IS NOT NULL
  UNION ALL
  SELECT 'projects.raw.' || e.key,
         p.id,
         ref.org_ref
  FROM projects p
  CROSS JOIN LATERAL jsonb_each(${asObject("p.raw")}) AS e
  CROSS JOIN LATERAL (SELECT ${orgRefFromValue("e.value")} AS org_ref) ref
  WHERE e.key ~* ${sqlQuote(ORG_LINK_KEY_SQL)}
    AND e.key !~* ${sqlQuote(CONTACT_KEY_SQL)}
    AND ref.org_ref IS NOT NULL
  UNION ALL
  ${CHILD_TABLES.map((table) => childLinks(table)).join("\nUNION ALL\n")}
)`;

function childLinks(table: (typeof CHILD_TABLES)[number]): string {
  const projectJoin = `JOIN projects p ON p.id = ${projectIdExpr("c")}`;
  return `SELECT ${sqlQuote(`${table}.org_id+project_id`)}::text,
         p.id,
         NULLIF(btrim(c.org_id), '')
  FROM ${table} c
  ${projectJoin}
  WHERE NULLIF(btrim(c.org_id), '') IS NOT NULL
  UNION ALL
  SELECT ${sqlQuote(`${table}.raw.`)} || e.key || '+project_id',
         p.id,
         ref.org_ref
  FROM ${table} c
  ${projectJoin}
  CROSS JOIN LATERAL jsonb_each(${asObject("c.raw")}) AS e
  CROSS JOIN LATERAL (SELECT ${orgRefFromValue("e.value")} AS org_ref) ref
  WHERE e.key ~* ${sqlQuote(ORG_LINK_KEY_SQL)}
    AND e.key !~* ${sqlQuote(CONTACT_KEY_SQL)}
    AND ref.org_ref IS NOT NULL`;
}

function rowCountsSql(): string {
  const columns = PROFILE_TABLES.map(
    (table) => `${asInt(`SELECT count(*) FROM ${table}`)} AS ${table}`,
  ).join(",\n  ");
  return `SELECT\n  ${columns}`;
}

function jsonbKeysSql(): string {
  return unionTables(
    (table) => `SELECT ${sqlQuote(table)}::text AS table_name,
       e.key,
       ${asInt("count(*)")} AS present,
       ${asInt(`count(*) FILTER (WHERE ${filledValue("e.value")})`)} AS filled,
       ${asInt(`SELECT count(*) FROM ${table}`)} AS total
FROM ${table}
CROSS JOIN LATERAL jsonb_each(${asObject(`${table}.raw`)}) AS e
GROUP BY e.key`,
  );
}

function categoricalSql(): string {
  const label = `CASE
    WHEN jsonb_typeof(e.value) IN ('string', 'number', 'boolean') THEN NULLIF(btrim(e.value #>> '{}'), '')
    WHEN jsonb_typeof(e.value) = 'object' THEN COALESCE(
      NULLIF(btrim(e.value->>'id'), ''),
      NULLIF(btrim(e.value->>'name'), ''),
      NULLIF(btrim(e.value->>'status'), ''),
      NULLIF(btrim(e.value->>'type'), ''),
      '(object)'
    )
    WHEN jsonb_typeof(e.value) = 'array' THEN '(array)'
    ELSE NULL
  END`;
  const grouped = unionTables(
    (table) => `SELECT ${sqlQuote(table)}::text AS table_name,
       e.key,
       left(v.label, 80) AS value,
       ${asInt("count(*)")} AS value_count
FROM ${table}
CROSS JOIN LATERAL jsonb_each(${asObject(`${table}.raw`)}) AS e
CROSS JOIN LATERAL (SELECT ${label} AS label) v
WHERE e.key ~* ${sqlQuote(CATEGORICAL_KEY_SQL)}
  AND e.key !~* ${sqlQuote(CONTACT_KEY_SQL)}
  AND v.label IS NOT NULL
GROUP BY e.key, left(v.label, 80)`,
  );
  return `SELECT table_name, key, value, value_count, distinct_values
FROM (
  SELECT table_name, key, value, value_count,
         row_number() OVER (PARTITION BY table_name, key ORDER BY value_count DESC, value) AS rn,
         ${asInt("count(*) OVER (PARTITION BY table_name, key)")} AS distinct_values
  FROM (
    ${grouped}
  ) grouped
) ranked
WHERE rn <= 25`;
}

function testOrgsSql(): string {
  return `SELECT id,
       coalesce(NULLIF(btrim(name), ''), NULLIF(btrim(raw->>'name'), '')) AS name,
       status,
       account_type,
       sub_status,
       ${asInt("count(*) OVER ()")} AS total
FROM orgs
WHERE coalesce(name, raw->>'name', '') ~* 'test|demo'
ORDER BY lower(coalesce(name, '')), id
LIMIT 200`;
}

function isTestSql(): string {
  const column = `SELECT 'projects.is_test'::text AS source,
       ${asInt("count(*) FILTER (WHERE is_test IS TRUE)")} AS true_count,
       ${asInt("count(*) FILTER (WHERE is_test IS FALSE)")} AS false_count,
       ${asInt("count(*) FILTER (WHERE is_test IS NULL)")} AS null_count,
       0::int AS missing_count,
       0::int AS other_count
FROM projects`;
  const raw = unionTables(
    (table) => `SELECT ${sqlQuote(`${table}.raw.is_test`)}::text AS source,
       ${asInt("count(*) FILTER (WHERE flag.kind = 'true')")} AS true_count,
       ${asInt("count(*) FILTER (WHERE flag.kind = 'false')")} AS false_count,
       ${asInt("count(*) FILTER (WHERE flag.kind = 'null')")} AS null_count,
       ${asInt("count(*) FILTER (WHERE flag.kind = 'missing')")} AS missing_count,
       ${asInt("count(*) FILTER (WHERE flag.kind = 'other')")} AS other_count
FROM ${table}
CROSS JOIN LATERAL (
  SELECT ${asObject(`${table}.raw`)} AS obj
) payload
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN NOT jsonb_exists(payload.obj, 'is_test') THEN 'missing'
    WHEN jsonb_typeof(payload.obj->'is_test') = 'null' THEN 'null'
    WHEN payload.obj->'is_test' = 'true'::jsonb OR lower(payload.obj->>'is_test') IN ('true', 't', '1', 'yes') THEN 'true'
    WHEN payload.obj->'is_test' = 'false'::jsonb OR lower(payload.obj->>'is_test') IN ('false', 'f', '0', 'no') THEN 'false'
    ELSE 'other'
  END AS kind
) flag`,
  );
  return `${column}\nUNION ALL\n${raw}`;
}

function linkRoutesSql(): string {
  const known = KNOWN_LINK_ROUTES.map((route) => `(${sqlQuote(route)})`).join(", ");
  return `WITH ${linksCte},
known AS (
  SELECT route FROM (VALUES ${known}) AS listed(route)
),
matched AS (
  SELECT l.route, l.project_id, o.id AS org_id
  FROM links l
  LEFT JOIN orgs o ON o.id = l.org_ref
),
agg AS (
  SELECT route,
         ${asInt("count(DISTINCT project_id)")} AS projects_with_link,
         ${asInt("count(DISTINCT project_id) FILTER (WHERE org_id IS NOT NULL)")} AS projects_mapped,
         ${asInt("count(DISTINCT org_id)")} AS orgs
  FROM matched
  GROUP BY route
),
totals AS (
  SELECT
    ${asInt("SELECT count(DISTINCT project_id) FROM matched WHERE org_id IS NOT NULL")} AS mapped_projects,
    ${asInt("SELECT count(*) FROM projects")} AS project_rows
)
SELECT k.route,
       coalesce(a.projects_with_link, 0)::int AS projects_with_link,
       coalesce(a.projects_mapped, 0)::int AS projects_mapped,
       coalesce(a.orgs, 0)::int AS orgs,
       t.mapped_projects,
       t.project_rows
FROM known k
CROSS JOIN totals t
LEFT JOIN agg a ON a.route = k.route
UNION ALL
SELECT a.route,
       a.projects_with_link,
       a.projects_mapped,
       a.orgs,
       t.mapped_projects,
       t.project_rows
FROM agg a
CROSS JOIN totals t
WHERE NOT EXISTS (SELECT 1 FROM known k WHERE k.route = a.route)`;
}

function monthsSql(): string {
  return `SELECT coalesce(to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM'), '') AS month,
       ${asInt("count(*)")} AS projects
FROM projects
GROUP BY 1
ORDER BY 1`;
}

function topOrgsSql(): string {
  return `WITH ${linksCte},
mapped AS (
  SELECT DISTINCT l.project_id, o.id AS org_id
  FROM links l
  JOIN orgs o ON o.id = l.org_ref
),
counts AS (
  SELECT o.id, o.name, ${asInt("count(m.project_id)")} AS projects
  FROM orgs o
  LEFT JOIN mapped m ON m.org_id = o.id
  GROUP BY o.id, o.name
)
SELECT c.id,
       c.name,
       c.projects,
       ${asInt("SELECT count(*) FROM counts z WHERE z.projects = 0")} AS zero_orgs
FROM counts c
ORDER BY c.projects DESC, lower(coalesce(c.name, '')), c.id
LIMIT 25`;
}

function qualitySql(): string {
  return unionTables((table) => {
    const columns = QUALITY_COLUMNS[table]
      .map((column) => {
        const filled =
          column.kind === "text"
            ? `count(NULLIF(btrim(${column.name}), ''))`
            : `count(${column.name})`;
        return `${sqlQuote(column.name)}, ${asInt(filled)}`;
      })
      .join(",\n         ");
    return `SELECT ${sqlQuote(table)}::text AS table_name,
       ${asInt("count(*)")} AS rows,
       ${asInt(`SELECT count(*) FROM (SELECT id FROM ${table} GROUP BY id HAVING count(*) > 1) dup_pk`)} AS duplicate_ids,
       ${asInt(`SELECT count(*) FROM (SELECT raw->>'id' AS raw_id FROM ${table} WHERE NULLIF(btrim(raw->>'id'), '') IS NOT NULL GROUP BY 1 HAVING count(*) > 1) dup_raw`)} AS duplicate_raw_ids,
       ${asInt("count(*) FILTER (WHERE raw->>'id' IS DISTINCT FROM id)")} AS raw_id_mismatches,
       jsonb_build_object(
         ${columns}
       ) AS filled
FROM ${table}`;
  });
}

function duplicateNamesSql(): string {
  return `SELECT min(btrim(name)) AS name,
       ${asInt("count(*)")} AS count,
       ${asInt("count(*) OVER ()")} AS groups
FROM orgs
WHERE NULLIF(btrim(name), '') IS NOT NULL
GROUP BY lower(btrim(name))
HAVING count(*) > 1
ORDER BY count(*) DESC, min(btrim(name))
LIMIT 25`;
}

export const profileSql = {
  rowCounts: rowCountsSql(),
  jsonbKeys: jsonbKeysSql(),
  categorical: categoricalSql(),
  testOrgs: testOrgsSql(),
  isTest: isTestSql(),
  linkRoutes: linkRoutesSql(),
  months: monthsSql(),
  topOrgs: topOrgsSql(),
  quality: qualitySql(),
  duplicateNames: duplicateNamesSql(),
} as const;

for (const statement of Object.values(profileSql)) assertSelectOnly(statement);

export const PROFILE_NOTES = [
  "Email addresses and phone numbers are omitted. A key with one of those names is counted, and its values are not listed.",
  "Fill rate is non-empty values divided by rows. JSON null, blank text, [], and {} count as empty.",
  "Blank text counts as missing in the null rates.",
  "A project maps to an org when the referenced id exists in orgs. Child-table routes also require a project_id that exists in projects.",
  "Object org links use the object's id. Months are UTC months of projects.created_at.",
];

type ProfileRows = {
  rowCounts: Record<string, unknown>[];
  jsonbKeys: Record<string, unknown>[];
  categorical: Record<string, unknown>[];
  testOrgs: Record<string, unknown>[];
  isTest: Record<string, unknown>[];
  linkRoutes: Record<string, unknown>[];
  months: Record<string, unknown>[];
  topOrgs: Record<string, unknown>[];
  quality: Record<string, unknown>[];
  duplicateNames: Record<string, unknown>[];
};

export async function queryProfile(db: ProfileDb, sql: string): Promise<Record<string, unknown>[]> {
  assertSelectOnly(sql);
  return db.query(sql);
}

export async function buildDataProfile(db: ProfileDb): Promise<DataProfile> {
  const [rowCounts, jsonbKeys, categorical, testOrgs, isTest, linkRoutes, months, topOrgs, quality, duplicateNames] =
    await Promise.all([
      queryProfile(db, profileSql.rowCounts),
      queryProfile(db, profileSql.jsonbKeys),
      queryProfile(db, profileSql.categorical),
      queryProfile(db, profileSql.testOrgs),
      queryProfile(db, profileSql.isTest),
      queryProfile(db, profileSql.linkRoutes),
      queryProfile(db, profileSql.months),
      queryProfile(db, profileSql.topOrgs),
      queryProfile(db, profileSql.quality),
      queryProfile(db, profileSql.duplicateNames),
    ]);
  return assembleProfile({
    rowCounts,
    jsonbKeys,
    categorical,
    testOrgs,
    isTest,
    linkRoutes,
    months,
    topOrgs,
    quality,
    duplicateNames,
  });
}

export function assembleProfile(rows: ProfileRows): DataProfile {
  const counts = rows.rowCounts[0] ?? {};
  const tables: TableCount[] = PROFILE_TABLES.map((table) => ({ table, rows: int(counts[table]) }));
  const rowsByTable = new Map(tables.map((table) => [table.table, table.rows]));

  const keys: TableKeys[] = PROFILE_TABLES.map((table) => ({
    table,
    rows: rowsByTable.get(table) ?? 0,
    keys: rows.jsonbKeys
      .filter((row) => text(row.table_name) === table)
      .map((row) => {
        const total = int(row.total);
        const filled = int(row.filled);
        return {
          key: text(row.key) ?? "",
          present: int(row.present),
          filled,
          fillRate: ratio(filled, total),
        };
      })
      .filter((row) => row.key.length > 0)
      .sort((a, b) => a.key.localeCompare(b.key)),
  }));

  const categorical = keys.flatMap((table) =>
    table.keys
      .filter((key) => isCategoricalKey(key.key))
      .map((key) => {
        const matches = rows.categorical.filter(
          (row) => text(row.table_name) === table.table && text(row.key) === key.key && !isContactKey(key.key),
        );
        const distinctValues = matches.reduce((max, row) => Math.max(max, int(row.distinct_values)), 0);
        const values = mergeValues(
          matches.map((row) => ({ value: text(row.value) ?? "", count: int(row.value_count) })),
        );
        return {
          table: table.table,
          key: key.key,
          distinctValues,
          truncated: distinctValues > 25,
          values,
        };
      }),
  );

  const testOrgRows = rows.testOrgs.map((row) => ({
    id: text(row.id) ?? "",
    name: optionalText(row.name),
    status: optionalText(row.status),
    accountType: optionalText(row.account_type),
    subStatus: optionalText(row.sub_status),
  }));
  const testTotal = rows.testOrgs.length > 0 ? int(rows.testOrgs[0]?.total) : 0;

  const isTestFlags = rows.isTest
    .map((row) => ({
      source: text(row.source) ?? "",
      trueCount: int(row.true_count),
      falseCount: int(row.false_count),
      nullCount: int(row.null_count),
      missingCount: int(row.missing_count),
      otherCount: int(row.other_count),
    }))
    .filter((flag) => flag.source === "projects.is_test" || flag.trueCount + flag.falseCount + flag.nullCount + flag.otherCount > 0);

  const linkByRoute = new Map<string, LinkRoute>();
  for (const route of KNOWN_LINK_ROUTES) {
    linkByRoute.set(route, emptyRoute(route));
  }
  for (const row of rows.linkRoutes) {
    const route = text(row.route);
    if (!route) continue;
    linkByRoute.set(route, {
      route,
      label: ROUTE_LABELS[route] ?? `${route} discovered from a raw org, organization, or office key`,
      projectsWithLink: int(row.projects_with_link),
      projectsMapped: int(row.projects_mapped),
      orgs: int(row.orgs),
    });
  }
  const knownOrder = new Map<string, number>(KNOWN_LINK_ROUTES.map((route, index) => [route, index]));
  const linkRoutes = [...linkByRoute.values()].sort((a, b) => {
    const aKnown = knownOrder.get(a.route);
    const bKnown = knownOrder.get(b.route);
    if (aKnown !== undefined && bKnown !== undefined) return aKnown - bKnown;
    if (aKnown !== undefined) return -1;
    if (bKnown !== undefined) return 1;
    return a.route.localeCompare(b.route);
  });

  const projectRows = rowsByTable.get("projects") ?? 0;
  const projectsMapped = rows.linkRoutes.reduce((max, row) => Math.max(max, int(row.mapped_projects)), 0);
  const projectsUnmapped = Math.max(0, projectRows - projectsMapped);

  const projectsByMonth: MonthCount[] = [];
  let projectsMissingCreatedAt = 0;
  for (const row of rows.months) {
    const month = text(row.month) ?? "";
    const projects = int(row.projects);
    if (!month) {
      projectsMissingCreatedAt += projects;
      continue;
    }
    projectsByMonth.push({ month, projects });
  }
  projectsByMonth.sort((a, b) => a.month.localeCompare(b.month));

  const topOrgs = rows.topOrgs
    .map((row) => ({
      id: text(row.id) ?? "",
      name: optionalText(row.name),
      projects: int(row.projects),
    }))
    .filter((org) => org.id.length > 0);
  const orgsWithZeroProjects = rows.topOrgs.length > 0 ? int(rows.topOrgs[0]?.zero_orgs) : 0;

  const quality = PROFILE_TABLES.map((table) => {
    const row = rows.quality.find((item) => text(item.table_name) === table);
    const total = int(row?.rows ?? rowsByTable.get(table) ?? 0);
    const filled = asRecord(row?.filled);
    return {
      table,
      rows: total,
      duplicateIds: int(row?.duplicate_ids),
      duplicateRawIds: int(row?.duplicate_raw_ids),
      rawIdMismatches: int(row?.raw_id_mismatches),
      columns: QUALITY_COLUMNS[table].map((column) => {
        const present = int(filled[column.name]);
        const nulls = Math.max(0, total - present);
        return { column: column.name, nulls, nullRate: ratio(nulls, total) };
      }),
    };
  });

  const duplicateOrgNames = rows.duplicateNames
    .map((row) => ({ name: text(row.name) ?? "", count: int(row.count) }))
    .filter((row) => row.name.length > 0);
  const duplicateOrgNameGroups = rows.duplicateNames.length > 0 ? int(rows.duplicateNames[0]?.groups) : 0;

  return scrubProfile({
    notes: PROFILE_NOTES,
    tables,
    keys,
    categorical,
    testOrgs: { total: testTotal, shown: testOrgRows.length, orgs: testOrgRows.filter((org) => org.id.length > 0) },
    isTestFlags,
    linkRoutes,
    projectsMapped,
    projectsUnmapped,
    projectsByMonth,
    projectsMissingCreatedAt,
    topOrgs,
    orgsWithZeroProjects,
    quality,
    duplicateOrgNames,
    duplicateOrgNameGroups,
  });
}

function emptyRoute(route: string): LinkRoute {
  return {
    route,
    label: ROUTE_LABELS[route] ?? route,
    projectsWithLink: 0,
    projectsMapped: 0,
    orgs: 0,
  };
}

function mergeValues(values: { value: string; count: number }[]): CategoricalValue[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const redacted = redactContacts(value.value).trim();
    if (!redacted) continue;
    counts.set(redacted, (counts.get(redacted) ?? 0) + value.count);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 25);
}

function scrubProfile(profile: DataProfile): DataProfile {
  return scrubValue(profile) as DataProfile;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return redactContacts(value);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactContacts(key), scrubValue(item)]));
  }
  return value;
}

function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return part / whole;
}

function int(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return 0;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function optionalText(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !raw.trim()) return null;
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}
