import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../app/api/data-profile/route";
import { sessionToken } from "../lib/auth-token";
import { dashboardAuthorized, readCookie } from "../lib/dashboard-auth";
import {
  CATEGORICAL_KEY_SQL,
  CONTACT_KEY_SQL,
  KNOWN_LINK_ROUTES,
  ORG_LINK_KEY_SQL,
  PROFILE_TABLES,
  assembleProfile,
  assertSelectOnly,
  buildDataProfile,
  isCategoricalKey,
  isContactKey,
  isOrgLinkKey,
  profileSql,
  queryProfile,
  redactContacts,
  type ProfileDb,
} from "../lib/data/profile";

const ORIGINAL_PASSWORD = process.env.DASHBOARD_PASSWORD;

afterEach(() => {
  if (ORIGINAL_PASSWORD === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = ORIGINAL_PASSWORD;
});

const CTE_NAMES = new Set([
  "links",
  "known",
  "matched",
  "agg",
  "totals",
  "counts",
  "mapped",
  "grouped",
  "ranked",
  "dup_pk",
  "dup_raw",
  "payload",
  "flag",
]);

describe("data profile sql", () => {
  it("uses a single select for every profile statement", () => {
    expect(assertSelectOnly("SELECT count(*) FROM orgs WHERE updated_at IS NOT NULL")).toBeUndefined();
    expect(() => assertSelectOnly("DELETE FROM orgs")).toThrow(/SELECT/);
    expect(() => assertSelectOnly("SELECT id FROM orgs; DELETE FROM orgs")).toThrow(/single statement/);
    expect(() => assertSelectOnly("WITH x AS (INSERT INTO orgs (id) VALUES ('a') RETURNING id) SELECT id FROM x")).toThrow(/write/);
    expect(() => assertSelectOnly("UPDATE orgs SET name = 'a'")).toThrow(/SELECT/);
    expect(() => assertSelectOnly("SELECT * FROM orgs FOR UPDATE")).toThrow(/lock/);
    expect(() => assertSelectOnly("SELECT * INTO copy FROM orgs")).toThrow(/write/);

    for (const statement of Object.values(profileSql)) {
      expect(() => assertSelectOnly(statement)).not.toThrow();
      const tables = referencedTables(statement);
      for (const table of tables) {
        expect(PROFILE_TABLES.includes(table as (typeof PROFILE_TABLES)[number]) || CTE_NAMES.has(table), table).toBe(true);
      }
    }
  });

  it("does not read email or phone columns", () => {
    for (const statement of Object.values(profileSql)) {
      const bare = statement.replace(/'(?:''|[^'])*'/g, "''").toLowerCase();
      expect(bare).not.toContain("email");
      expect(bare).not.toContain("phone");
    }
    expect(profileSql.categorical).toContain(CATEGORICAL_KEY_SQL);
    expect(profileSql.categorical).toContain(CONTACT_KEY_SQL);
    expect(profileSql.linkRoutes).toContain(ORG_LINK_KEY_SQL);
    expect(profileSql.linkRoutes).toContain("commissions.raw.");
    expect(profileSql.linkRoutes).toContain("organization_id");
    expect(profileSql.linkRoutes).toContain("esign_status");
    for (const route of KNOWN_LINK_ROUTES) expect(profileSql.linkRoutes).toContain(route);
  });

  it("classifies filter keys and org links, and redacts contact values", () => {
    expect(isCategoricalKey("account_type")).toBe(true);
    expect(isCategoricalKey("payment_status")).toBe(true);
    expect(isCategoricalKey("sub_status")).toBe(true);
    expect(isCategoricalKey("plan_name")).toBe(true);
    expect(isCategoricalKey("active_user_count")).toBe(true);
    expect(isCategoricalKey("is_test")).toBe(true);
    expect(isCategoricalKey("parent_id")).toBe(true);
    expect(isCategoricalKey("office_id")).toBe(true);
    expect(isCategoricalKey("sub_org")).toBe(true);
    expect(isCategoricalKey("job_type")).toBe(true);
    expect(isCategoricalKey("email")).toBe(false);
    expect(isCategoricalKey("phone_number")).toBe(false);
    expect(isCategoricalKey("name")).toBe(false);

    expect(isOrgLinkKey("org_id")).toBe(true);
    expect(isOrgLinkKey("organization_id")).toBe(true);
    expect(isOrgLinkKey("org")).toBe(true);
    expect(isOrgLinkKey("organization")).toBe(true);
    expect(isOrgLinkKey("sub_org_id")).toBe(true);
    expect(isOrgLinkKey("parent_organization_id")).toBe(true);
    expect(isOrgLinkKey("office_id")).toBe(true);
    expect(isOrgLinkKey("billing_office")).toBe(true);
    expect(isOrgLinkKey("organization_name")).toBe(false);
    expect(isOrgLinkKey("parent_id")).toBe(false);
    expect(isOrgLinkKey("org_email")).toBe(false);
    expect(isContactKey("customer_email")).toBe(true);

    expect(redactContacts("ada@example.com")).toBe("[email]");
    expect(redactContacts("Demo ada@example.com Solar")).toBe("Demo [email] Solar");
    expect(redactContacts("+1 (415) 555-0199")).toBe("[phone]");
    expect(redactContacts("415-555-0199")).toBe("[phone]");
    expect(redactContacts("+14155550199")).toBe("[phone]");
    expect(redactContacts("org_4155550199")).toBe("org_4155550199");
  });
});

describe("data profile assembly", () => {
  it("profiles fixture rows and keeps contact values out of the output", async () => {
    const profile = assembleProfile({
      rowCounts: [{ orgs: 3, org_subscriptions: 1, projects: 4, financials: 0, esign_status: 1, commissions: 2 }],
      jsonbKeys: [
        { table_name: "orgs", key: "email", present: 3, filled: 2, total: 3 },
        { table_name: "orgs", key: "status", present: 3, filled: 2, total: 3 },
        { table_name: "orgs", key: "account_type", present: 1, filled: 1, total: 3 },
        { table_name: "projects", key: "is_test", present: 4, filled: 3, total: 4 },
        { table_name: "projects", key: "job_type", present: 2, filled: 2, total: 4 },
        { table_name: "projects", key: "phone", present: 1, filled: 1, total: 4 },
      ],
      categorical: [
        { table_name: "orgs", key: "status", value: "active", value_count: 1, distinct_values: 2 },
        { table_name: "orgs", key: "status", value: "ada@example.com", value_count: 1, distinct_values: 2 },
        { table_name: "orgs", key: "account_type", value: "epc", value_count: 1, distinct_values: 1 },
        { table_name: "projects", key: "is_test", value: "true", value_count: 1, distinct_values: 2 },
        { table_name: "projects", key: "is_test", value: "false", value_count: 2, distinct_values: 2 },
        { table_name: "projects", key: "job_type", value: "+1 (415) 555-0199", value_count: 2, distinct_values: 1 },
        { table_name: "projects", key: "phone", value: "415-555-0199", value_count: 4, distinct_values: 1 },
      ],
      testOrgs: [
        { id: "org_demo", name: "Demo Solar", status: "active", account_type: "epc", sub_status: null, total: 2 },
        { id: "org_test", name: "Test ada@example.com", status: null, account_type: null, sub_status: "paused", total: 2 },
      ],
      isTest: [
        { source: "projects.is_test", true_count: 1, false_count: 2, null_count: 1, missing_count: 0, other_count: 0 },
        { source: "orgs.raw.is_test", true_count: 0, false_count: 0, null_count: 0, missing_count: 3, other_count: 0 },
        { source: "projects.raw.is_test", true_count: 1, false_count: 2, null_count: 0, missing_count: 1, other_count: 0 },
      ],
      linkRoutes: [
        {
          route: "projects.org_id",
          projects_with_link: 3,
          projects_mapped: 2,
          orgs: 1,
          mapped_projects: 3,
          project_rows: 4,
        },
        {
          route: "commissions.raw.organization_id+project_id",
          projects_with_link: 2,
          projects_mapped: 1,
          orgs: 1,
          mapped_projects: 3,
          project_rows: 4,
        },
        {
          route: "projects.raw.billing_office",
          projects_with_link: 1,
          projects_mapped: 1,
          orgs: 1,
          mapped_projects: 3,
          project_rows: 4,
        },
      ],
      months: [
        { month: "", projects: 1 },
        { month: "2026-03", projects: 1 },
        { month: "2026-01", projects: 2 },
      ],
      topOrgs: [
        { id: "org_demo", name: "Demo Solar", projects: 2, zero_orgs: 1 },
        { id: "org_live", name: "North Roofing", projects: 1, zero_orgs: 1 },
        { id: "org_quiet", name: "Quiet Co", projects: 0, zero_orgs: 1 },
      ],
      quality: [
        {
          table_name: "orgs",
          rows: 3,
          duplicate_ids: 0,
          duplicate_raw_ids: 1,
          raw_id_mismatches: 1,
          filled: { id: 3, name: 3, status: 2, account_type: 1 },
        },
        {
          table_name: "projects",
          rows: "4",
          duplicate_ids: 0,
          duplicate_raw_ids: 0,
          raw_id_mismatches: 0,
          filled: { id: 4, org_id: 3, is_test: 3, created_at: 3 },
        },
      ],
      duplicateNames: [{ name: "Acme Roofing", count: 2, groups: 1 }],
    });

    expect(profile.tables.map((table) => [table.table, table.rows])).toEqual([
      ["orgs", 3],
      ["org_subscriptions", 1],
      ["projects", 4],
      ["financials", 0],
      ["esign_status", 1],
      ["commissions", 2],
    ]);
    expect(profile.keys.find((table) => table.table === "orgs")?.keys).toEqual([
      { key: "account_type", present: 1, filled: 1, fillRate: 1 / 3 },
      { key: "email", present: 3, filled: 2, fillRate: 2 / 3 },
      { key: "status", present: 3, filled: 2, fillRate: 2 / 3 },
    ]);

    const status = profile.categorical.find((field) => field.table === "orgs" && field.key === "status");
    expect(status?.values).toEqual([
      { value: "[email]", count: 1 },
      { value: "active", count: 1 },
    ]);
    expect(profile.categorical.some((field) => field.key === "phone" || field.key === "email")).toBe(false);
    expect(profile.categorical.find((field) => field.key === "job_type")?.values).toEqual([{ value: "[phone]", count: 2 }]);

    expect(profile.testOrgs.total).toBe(2);
    expect(profile.testOrgs.orgs[1]?.name).toBe("Test [email]");
    expect(profile.isTestFlags.map((flag) => flag.source)).toEqual(["projects.is_test", "projects.raw.is_test"]);

    expect(profile.linkRoutes.map((route) => route.route)).toEqual([...KNOWN_LINK_ROUTES, "projects.raw.billing_office"]);
    expect(profile.linkRoutes.find((route) => route.route === "projects.org_id")).toMatchObject({
      projectsWithLink: 3,
      projectsMapped: 2,
      orgs: 1,
    });
    expect(profile.linkRoutes.find((route) => route.route === "commissions.raw.organization_id+project_id")?.label).toMatch(/organization_id/);
    expect(profile.linkRoutes.find((route) => route.route === "esign_status.org_id+project_id")?.projectsMapped).toBe(0);
    expect(profile.projectsMapped).toBe(3);
    expect(profile.projectsUnmapped).toBe(1);

    expect(profile.projectsByMonth).toEqual([
      { month: "2026-01", projects: 2 },
      { month: "2026-03", projects: 1 },
    ]);
    expect(profile.projectsMissingCreatedAt).toBe(1);
    expect(profile.topOrgs.map((org) => org.id)).toEqual(["org_demo", "org_live", "org_quiet"]);
    expect(profile.orgsWithZeroProjects).toBe(1);

    expect(profile.quality.find((table) => table.table === "orgs")).toMatchObject({
      duplicateIds: 0,
      duplicateRawIds: 1,
      rawIdMismatches: 1,
    });
    expect(profile.quality.find((table) => table.table === "orgs")?.columns.find((column) => column.column === "status")).toEqual({
      column: "status",
      nulls: 1,
      nullRate: 1 / 3,
    });
    expect(profile.quality.find((table) => table.table === "projects")?.columns.find((column) => column.column === "created_at")?.nulls).toBe(1);
    expect(profile.quality.every((table) => table.columns.every((column) => column.column !== "email"))).toBe(true);
    expect(profile.duplicateOrgNames).toEqual([{ name: "Acme Roofing", count: 2 }]);
    expect(profile.duplicateOrgNameGroups).toBe(1);

    const json = JSON.stringify(profile);
    expect(json).not.toContain("ada@example.com");
    expect(json).not.toContain("@");
    expect(json).not.toContain("555-0199");
    expect(json).not.toContain("415-555");
  });

  it("fills known routes and zero counts when the database is empty", async () => {
    const seen: string[] = [];
    const db: ProfileDb = {
      async query(sql) {
        seen.push(sql);
        return [];
      },
    };
    const profile = await buildDataProfile(db);
    expect(seen).toEqual(Object.values(profileSql));
    expect(profile.tables.every((table) => table.rows === 0)).toBe(true);
    expect(profile.linkRoutes.map((route) => route.route)).toEqual([...KNOWN_LINK_ROUTES]);
    expect(profile.projectsMapped).toBe(0);
    expect(profile.projectsUnmapped).toBe(0);
    expect(profile.orgsWithZeroProjects).toBe(0);
    expect(profile.testOrgs.total).toBe(0);
    expect(profile.duplicateOrgNameGroups).toBe(0);
    expect(profile.categorical).toEqual([]);
  });

  it("refuses to send a write to the database", async () => {
    let called = false;
    const db: ProfileDb = {
      async query() {
        called = true;
        return [];
      },
    };
    await expect(queryProfile(db, "DELETE FROM projects")).rejects.toThrow(/SELECT/);
    await expect(queryProfile(db, "WITH x AS (INSERT INTO orgs (id, raw) VALUES ('a', '{}') RETURNING id) SELECT id FROM x")).rejects.toThrow(/write/);
    expect(called).toBe(false);
  });
});

describe("data profile gate", () => {
  it("keeps /data-profile behind the same dashboard password as /sync", () => {
    const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
    const loader = readFileSync(new URL("../lib/data/profile-load.ts", import.meta.url), "utf8");
    expect(middleware).not.toMatch(/data-profile/);
    expect(middleware).toContain("cxm_session");
    expect(middleware).toContain("DASHBOARD_PASSWORD");
    expect(loader).not.toMatch(/\b(insert|update|delete|ensureMigrations)\b/i);
    expect(readCookie("a=1; cxm_session=abc%3D; b=2", "cxm_session")).toBe("abc=");
  });

  it("accepts the dashboard session and rejects a missing one", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const open = new Request("https://example.com/api/data-profile");
    expect(await dashboardAuthorized(open)).toBe(true);

    process.env.DASHBOARD_PASSWORD = "dashboard-secret";
    expect(await dashboardAuthorized(open)).toBe(false);
    const wrong = new Request("https://example.com/api/data-profile", {
      headers: { cookie: "cxm_session=nope" },
    });
    expect(await dashboardAuthorized(wrong)).toBe(false);
    const token = await sessionToken("dashboard-secret");
    const authed = new Request("https://example.com/api/data-profile", {
      headers: { cookie: `cxm_session=${token}` },
    });
    expect(await dashboardAuthorized(authed)).toBe(true);

    const denied = await GET(open);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "Unauthorized" });
  });
});

function referencedTables(sql: string): string[] {
  const masked = sql.replace(/\bis\s+distinct\s+from\b/gi, " ");
  return [...masked.matchAll(/\b(?:from|join)\s+(?!lateral\b)([a-z_][a-z0-9_]*)/gi)].map((match) => match[1] ?? "");
}
