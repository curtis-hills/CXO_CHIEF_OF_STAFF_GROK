import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiOrg, ApiProject } from "../lib/api/types";
import { connectionMessage } from "../lib/data/connection-message";
import { assemblePortfolio } from "../lib/data/assemble";
import {
  DEFAULT_ORG_STATUSES,
  applyPortfolioFilter,
  countByPerson,
  countByStatus,
  isPaymentFlagged,
  isQaBotName,
  isTestOrDemoOrg,
  readPortfolioFilter,
  type FilterableOrg,
} from "../lib/data/filters";
import { projectsByOrg } from "../lib/data/project-orgs";
import { calendarDaysBetween } from "../lib/metrics/calendar";
import { MemoryStore } from "../lib/sync/memory-store";
import type { GenericRow, OrgRow, ProjectRow } from "../lib/sync/rows";

const AS_OF = "2026-10-15T18:00:00.000Z";

function org(partial: Partial<FilterableOrg> & Pick<FilterableOrg, "name" | "status">): FilterableOrg {
  return {
    paymentStatus: "active",
    cxm: { name: "Maya Chen" },
    ae: { name: "Chris Dalton" },
    ...partial,
  };
}

describe("portfolio filter", () => {
  const rows: FilterableOrg[] = [
    org({ id: "won", name: "Northwind Solar", status: "Won" }),
    org({ id: "onboarding", name: "Peakline", status: "Onboarding", cxm: null }),
    org({ id: "launched", name: "Harbor", status: "Launched", paymentStatus: "cancelled", ae: null }),
    org({ id: "retention", name: "Mesa", status: "Retention", paymentStatus: "suspended" }),
    org({ id: "dormant", name: "Quiet Co", status: "Dormant" }),
    org({ id: "test-name", name: "Sunridge Test", status: "Won" }),
    org({ id: "demo-name", name: "Acme Demo", status: "Launched" }),
    org({ id: "qa", name: "QA Bot", status: "Launched" }),
    org({ id: "qa-spaced", name: "West QA-Bot", status: "Won" }),
    org({ id: "demo-status", name: "Plain Name", status: "Demo" }),
    org({ id: "demo-org", name: "Another Plain", status: "Demo Org" }),
    org({ id: "real", name: "Greatest Solar", status: "Won", cxm: { name: "Priya Shah" } }),
  ];

  it("hides test, demo, and QA Bot orgs and defaults to the approved statuses", () => {
    expect(isQaBotName("QA Bot")).toBe(true);
    expect(isQaBotName("qa-bot 2")).toBe(true);
    expect(isQaBotName("Quality Bots")).toBe(false);
    expect(isTestOrDemoOrg({ name: "Greatest Solar", status: "Won" })).toBe(false);
    expect(isTestOrDemoOrg({ name: "Contest Solar", status: "Won" })).toBe(false);
    expect(isTestOrDemoOrg({ name: "Demonstration Homes", status: "Won" })).toBe(false);
    expect(isTestOrDemoOrg({ name: "Solar Test", status: "Won" })).toBe(true);
    expect(isTestOrDemoOrg({ name: "Plain Name", status: "Demo" })).toBe(true);

    const filter = readPortfolioFilter({}, "live");
    expect(filter.statusMode).toBe("default");
    expect(filter.statuses).toEqual([...DEFAULT_ORG_STATUSES]);
    expect(filter.includeTests).toBe(false);

    const kept = applyPortfolioFilter(rows, filter).map((item) => item.id);
    expect(kept.sort()).toEqual(["launched", "onboarding", "real", "retention", "won"]);
    expect(applyPortfolioFilter(rows, filter).find((item) => item.id === "launched")?.paymentStatus).toBe("cancelled");
    expect(isPaymentFlagged("suspended")).toBe(true);
    expect(isPaymentFlagged("canceled")).toBe(true);
    expect(isPaymentFlagged("active")).toBe(false);
  });

  it("reads the filter bar from the URL", () => {
    const filter = readPortfolioFilter(
      { org: ["won", "Dormant"], cxm: "Priya Shah", ae: "unassigned", tests: "1", pay: "flagged", orgSet: "1" },
      "live",
    );
    expect(filter.statusMode).toBe("explicit");
    expect(filter.statuses).toEqual(["Won", "Dormant"]);
    expect(filter.includeTests).toBe(true);
    expect(filter.payment).toBe("flagged");

    expect(applyPortfolioFilter(rows, filter)).toEqual([]);
    expect(applyPortfolioFilter(rows, readPortfolioFilter({ pay: "flagged", orgSet: "1" }, "live")).map((item) => item.id).sort()).toEqual([
      "launched",
      "retention",
    ]);
    expect(applyPortfolioFilter(rows, readPortfolioFilter({ cxm: "Priya Shah", orgSet: "1" }, "live")).map((item) => item.id)).toEqual([
      "real",
    ]);
    expect(applyPortfolioFilter(rows, readPortfolioFilter({ ae: "unassigned", orgSet: "1" }, "live")).map((item) => item.id)).toEqual([
      "launched",
    ]);

    const all = readPortfolioFilter({ orgSet: "1" }, "live");
    expect(all.statusMode).toBe("all");
    expect(all.statuses).toEqual([]);
    expect(applyPortfolioFilter(rows, all).some((item) => item.id === "dormant")).toBe(true);
    expect(applyPortfolioFilter(rows, all).some((item) => item.id === "test-name")).toBe(false);

    const withTests = readPortfolioFilter({ orgSet: "1", tests: "1" }, "live");
    expect(applyPortfolioFilter(rows, withTests).some((item) => item.id === "qa")).toBe(true);

    const mock = readPortfolioFilter({}, "mock");
    expect(mock.statusMode).toBe("all");
    expect(applyPortfolioFilter(rows, { ...mock, statuses: [] }).some((item) => item.status === "Dormant")).toBe(true);
  });

  it("counts statuses and CXMs, including a zero for a selected status", () => {
    const filter = readPortfolioFilter({}, "live");
    const kept = applyPortfolioFilter(rows, filter);
    expect(countByStatus(kept, filter.statuses).map((row) => `${row.name}:${row.count}`)).toEqual([
      "Won:2",
      "Launched:1",
      "Onboarding:1",
      "Retention:1",
    ]);
    expect(countByPerson(kept, "cxm").find((row) => row.name === "Unassigned")?.count).toBe(1);
    expect(countByPerson(kept, "ae").find((row) => row.name === "Unassigned")?.count).toBe(1);
  });
});

describe("project org links", () => {
  it("maps projects from the column, raw jsonb, and child organization ids", () => {
    const grouped = projectsByOrg({
      orgIds: ["9", "4"],
      projects: [
        { id: "column", orgId: "9", raw: { organization_id: "4" }, createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "raw", orgId: null, raw: { organization_id: "4", created_at: "2026-08-01T00:00:00.000Z" } },
        { id: "missing-column", orgId: "nope", raw: { organization: { id: "9" } } },
        { id: "esign", orgId: null, raw: { id: "esign" } },
        { id: "commission", orgId: null, raw: {} },
        { id: "orphan", orgId: null, raw: { organization_id: "missing" } },
      ],
      esign: [{ orgId: null, projectId: null, raw: { organization_id: "9", project: { id: "esign" } } }],
      commissions: [{ orgId: "4", projectId: "commission", raw: { organization_id: "9" } }],
    });

    expect(grouped.links.find((link) => link.projectId === "column")).toMatchObject({ orgId: "9", route: "projects.org_id" });
    expect(grouped.links.find((link) => link.projectId === "raw")).toMatchObject({
      orgId: "4",
      route: "projects.raw.organization_id",
    });
    expect(grouped.links.find((link) => link.projectId === "missing-column")).toMatchObject({
      orgId: "9",
      route: "projects.raw.organization",
    });
    expect(grouped.links.find((link) => link.projectId === "esign")).toMatchObject({
      orgId: "9",
      route: "esign_status.raw.organization_id+project_id",
    });
    expect(grouped.links.find((link) => link.projectId === "commission")).toMatchObject({
      orgId: "4",
      route: "commissions.org_id+project_id",
    });
    expect(grouped.links.find((link) => link.projectId === "orphan")).toBeUndefined();
    expect(grouped.projectsByOrg["4"]?.map((project) => project.id).sort()).toEqual(["commission", "raw"]);
    expect(grouped.projectsByOrg["9"]?.find((project) => project.id === "column")?.created_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("loads the same links from the memory store", async () => {
    const store = new MemoryStore();
    const orgRow: OrgRow = {
      id: "9",
      name: "Northwind",
      email: null,
      status: "Launched",
      subStatus: null,
      paymentStatus: "active",
      accountType: null,
      city: null,
      state: null,
      cxmId: null,
      cxmName: null,
      aeId: null,
      aeName: null,
      activeUserCount: null,
      createdAt: null,
      updatedAt: null,
      raw: { id: "9", name: "Northwind", status: "Launched" },
    };
    await store.upsertOrgs([orgRow], []);
    const project: ProjectRow = {
      id: "p",
      orgId: null,
      jobType: null,
      systemSize: null,
      isTest: false,
      deletedAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: null,
      raw: { id: "p" },
    };
    store.projects.set(project.id, project);
    const esign: GenericRow = {
      id: "e",
      orgId: null,
      projectId: "p",
      status: null,
      amount: null,
      createdAt: null,
      updatedAt: null,
      raw: { organization_id: "9" },
    };
    store.esign.set(esign.id, esign);
    const grouped = await store.loadProjectsByOrg();
    expect(grouped["9"]?.map((item) => item.id)).toEqual(["p"]);
    expect(grouped["9"]?.[0]?.created_at).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("launch date proxy", () => {
  it("uses the earliest project date and labels the launch date unknown", () => {
    const launched: ApiOrg = {
      id: "1",
      name: "Northwind Solar",
      status: "Launched",
      payment_status: "cancelled",
      customer_experience_manager: { id: "c", name: "Maya Chen" },
    };
    const projects: ApiProject[] = [
      { id: "late", created_at: "2026-10-01T12:00:00.000Z" },
      { id: "early", created_at: "2026-09-01T12:00:00.000Z" },
      { id: "test", created_at: "2026-09-02T12:00:00.000Z", is_test: true },
      { id: "deleted", created_at: "2026-09-03T12:00:00.000Z", deleted_at: "2026-09-04T00:00:00.000Z" },
    ];
    const { accounts } = assemblePortfolio({
      mode: "live",
      asOf: AS_OF,
      orgs: [launched, { id: "2", name: "Quiet Co", status: "Won" }],
      projectsByOrg: { "1": projects },
      projectsAvailable: true,
      proxies: {},
      overrides: {},
    });
    const account = accounts.find((item) => item.id === "1");
    expect(account?.launchDateUnknown).toBe(true);
    expect(account?.launchedAt.source).toBe("proxy");
    expect(account?.launchedAt.note).toMatch(/Launch date unknown/);
    expect(account?.launchedAt.iso).toBe("2026-09-01T12:00:00.000Z");
    expect(account?.pace?.day).toBe(calendarDaysBetween("2026-09-01T12:00:00.000Z", AS_OF));
    expect(account?.pace?.actual).toBe(2);
    expect(account?.paymentStatus).toBe("cancelled");
    expect(accounts.find((item) => item.id === "2")?.launchDateUnknown).toBe(false);
  });

  it("keeps a missing launch date when no project date exists", () => {
    const { accounts } = assemblePortfolio({
      mode: "live",
      asOf: AS_OF,
      orgs: [{ id: "1", name: "Harbor", status: "Launched" }],
      projectsByOrg: {},
      projectsAvailable: true,
      proxies: {},
      overrides: {},
    });
    expect(accounts[0]?.launchDateUnknown).toBe(true);
    expect(accounts[0]?.launchedAt.source).toBe("missing");
    expect(accounts[0]?.launchedAt.note).toMatch(/Launch date unknown/);
    expect(accounts[0]?.pace).toBeNull();
  });

  it("prefers an API or manual launch date over the project proxy", () => {
    const api = assemblePortfolio({
      mode: "live",
      asOf: AS_OF,
      orgs: [{ id: "1", name: "Harbor", status: "Launched", launched_at: "2026-10-01T00:00:00.000Z" }],
      projectsByOrg: { "1": [{ id: "p", created_at: "2026-01-01T00:00:00.000Z" }] },
      projectsAvailable: true,
      proxies: {},
      overrides: {},
    });
    expect(api.accounts[0]?.launchDateUnknown).toBe(false);
    expect(api.accounts[0]?.launchedAt.source).toBe("api");

    const manual = assemblePortfolio({
      mode: "live",
      asOf: AS_OF,
      orgs: [{ id: "1", name: "Harbor", status: "Launched" }],
      projectsByOrg: { "1": [{ id: "p", created_at: "2026-01-01T00:00:00.000Z" }] },
      projectsAvailable: true,
      proxies: {},
      overrides: { "1": { launchedAt: "2026-10-10T00:00:00.000Z" } },
    });
    expect(manual.accounts[0]?.launchDateUnknown).toBe(false);
    expect(manual.accounts[0]?.launchedAt.source).toBe("manual");
  });
});

describe("stored copy banner", () => {
  it("drops the demo banner when real data exists and shows data as of", () => {
    const live = connectionMessage({
      mode: "live",
      notice: null,
      dataAsOf: "2026-10-16T09:00:00.000Z",
    });
    expect(live.title).toBe("Stored copy.");
    expect(live.body).not.toMatch(/Demo data/i);
    expect(live.body).toContain("Data as of");

    const backfill = connectionMessage({
      mode: "live",
      notice: "Projects have not been synced yet.",
      dataAsOf: "2026-10-16T09:00:00.000Z",
    });
    expect(backfill.title).toBe("Stored copy.");
    expect(backfill.body).toContain("Projects have not been synced yet.");
    expect(backfill.body).toContain("Data as of");

    const demo = connectionMessage({ mode: "mock", notice: null, dataAsOf: null });
    expect(demo.title).toBe("Demo data.");
  });
});

describe("page renders do not call SubcontractorHub", () => {
  it("keeps the API client out of pages and the portfolio loader", () => {
    const files = [...walk("app"), ...walk("components")];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/lib\/api\/client/);
      expect(source, file).not.toMatch(/getLiveInputs|fetchOrgs|fetchProjectsByOrg/);
    }
    const loader = readFileSync("lib/data/load.ts", "utf8");
    expect(loader).not.toContain("api/client");
    expect(loader).not.toContain("live-cache");
    for (const page of ["app/(dash)/pre-launch/page.tsx", "app/(dash)/accounts/page.tsx", "app/(dash)/health/page.tsx"]) {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("visibleBook");
      expect(source).toContain("OrgFilterFields");
      expect(source).toContain("OrgBreakdown");
    }
  });
});

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}
