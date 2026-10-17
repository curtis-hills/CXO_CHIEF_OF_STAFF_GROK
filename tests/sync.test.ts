import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resetApiSession } from "../lib/api/client";
import { ENDPOINTS } from "../lib/sync/catalog";
import { cronAuthorized } from "../lib/sync/cron";
import { dispatchCronFollowUp, planCronFollowUp } from "../lib/sync/follow";
import { backfillLabel, storedCopyStatus } from "../lib/sync/progress";
import { emptyCursor } from "../lib/sync/types";
import {
  advanceHighWater,
  cursorToPersist,
  nextOffsetPage,
  paceDelayMs,
  resumeAdvanced,
  selectSyncQuery,
  shouldFullReconcile,
  splitAtHighWater,
  tieAdvanced,
  upsertById,
} from "../lib/sync/high-water";
import { normalizeOrg } from "../lib/sync/rows";
import { resetSyncInflight, runSync } from "../lib/sync/runner";
import { cursorStateFromRow, ORG_UPSERT, PROJECT_UPSERT } from "../lib/sync/postgres-store";
import { freshCursor } from "../lib/sync/memory-store";
import { memoryStore, resetMemoryStore } from "../lib/sync/store";

afterEach(() => {
  resetMemoryStore();
  resetSyncInflight();
  resetApiSession();
  delete process.env.SUBHUB_API_USERNAME;
  delete process.env.SUBHUB_API_PASSWORD;
  delete process.env.SUBHUB_API_KEY;
  delete process.env.SUBHUB_AUTH_MODE;
  delete process.env.SUBHUB_API_BASE_URL;
  delete process.env.CRON_SECRET;
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
});

describe("sync high water and upsert", () => {
  it("upserts by id and never moves the high-water mark backward", () => {
    const rows = new Map<string, { id: string; name: string }>();
    expect(upsertById(rows, [{ id: "a", name: "One" }])).toEqual({ inserted: 1, updated: 0 });
    expect(upsertById(rows, [{ id: "a", name: "Two" }, { id: "b", name: "Three" }])).toEqual({ inserted: 1, updated: 1 });
    expect(rows.get("a")?.name).toBe("Two");
    expect(rows.size).toBe(2);

    const mark = advanceHighWater(null, [{ updated_at: "2026-01-02T00:00:00.000Z" }, { created_at: "2026-01-01T00:00:00.000Z" }]);
    expect(mark).toBe("2026-01-02T00:00:00.000Z");
    expect(advanceHighWater(mark, [{ updated_at: "2026-01-01T00:00:00.000Z" }])).toBe(mark);
    expect(normalizeOrg({ name: "missing id" })).toBeNull();
  });

  it("stops a newest-first page at the high-water mark and keeps crawling an oldest-first page", () => {
    const rows = [
      { id: "new", updated_at: "2026-03-02T00:00:00.000Z" },
      { id: "old", updated_at: "2026-01-01T00:00:00.000Z" },
    ];
    expect(splitAtHighWater(rows, "2026-02-01T00:00:00.000Z", "newest-first")).toEqual({
      fresh: [rows[0]],
      reached: true,
    });
    expect(splitAtHighWater([...rows].reverse(), "2026-02-01T00:00:00.000Z", "oldest-first").reached).toBe(false);
    const tied = [
      { id: "a", updated_at: "2026-03-31T18:54:00.000Z" },
      { id: "b", updated_at: "2026-03-31T18:54:00.000Z" },
      { id: "c", updated_at: "2026-03-01T00:00:00.000Z" },
    ];
    expect(splitAtHighWater(tied, "2026-03-31T18:54:00.000Z", "newest-first")).toEqual({
      fresh: [tied[0], tied[1]],
      reached: true,
    });
    expect(splitAtHighWater(tied.slice(0, 2), "2026-03-31T18:54:00.000Z", "newest-first").reached).toBe(false);
  });

  it("treats a repeated timestamp cursor as not advanced and keeps offset pages", () => {
    expect(
      resumeAdvanced(
        { cursor: "2026-03-31T18:54Z", page: null },
        { cursor: "2026-03-31T18:54:00.000Z", page: null },
      ),
    ).toBe(false);
    expect(resumeAdvanced({ cursor: "c1", page: null }, { cursor: "c2", page: null })).toBe(true);
    expect(resumeAdvanced({ cursor: null, page: null }, { cursor: "c1", page: null })).toBe(true);
    expect(nextOffsetPage(0, 50)).toBe(1);
    expect(nextOffsetPage(50, 50)).toBe(2);
    expect(nextOffsetPage(10050, 50)).toBe(202);
    const tail = "2026-10-08T13:32:54.000Z";
    expect(
      cursorToPersist(tail, [
        { id: "9", updated_at: tail },
        { id: "10", updated_at: tail },
      ]),
    ).toBe(`${tail}|10`);
    expect(cursorToPersist("opaque-2", [{ id: "10", updated_at: tail }])).toBe("opaque-2");
    expect(tieAdvanced({ at: tail, id: "10" }, [{ id: "10", updated_at: tail }])).toBe(false);
    expect(tieAdvanced({ at: tail, id: "10" }, [{ id: "11", updated_at: tail }])).toBe(true);
    expect(tieAdvanced({ at: tail, id: "10" }, [{ id: "11", updated_at: "2026-10-07T00:00:00.000Z" }])).toBe(false);
    const parsed = cursorStateFromRow({
      cursor: "abc",
      page: "4",
      high_water: "2026-03-31T18:54:00.000Z",
      pass_complete: "f",
      backfill_complete: "t",
      disabled: "false",
      strategy: "platform",
      org_index: "3",
      full_pass: false,
      unsupported_filters: [],
      unsupported_sorts: [],
      last_error: null,
    });
    expect(parsed.page).toBe(4);
    expect(parsed.backfillComplete).toBe(true);
    expect(parsed.orgIndex).toBe(3);
    expect(parsed.disabled).toBe(false);
  });

  it("probes updated_since before a newest-first sort", () => {
    const filtered = selectSyncQuery({
      mode: "incremental",
      full: false,
      highWater: "2026-01-01T00:00:00.000Z",
      cursor: "abc",
      page: null,
      unsupportedFilters: [],
      unsupportedSorts: [],
    });
    expect(filtered.filter).toBe("updated_since");
    expect(filtered.params.updated_since).toBe("2026-01-01T00:00:00.000Z");
    expect(filtered.params.cursor).toBe("abc");

    const sorted = selectSyncQuery({
      mode: "incremental",
      full: false,
      highWater: "2026-01-01T00:00:00.000Z",
      cursor: null,
      page: null,
      unsupportedFilters: ["updated_since", "updated_after", "from", "updated_at_from"],
      unsupportedSorts: [],
    });
    expect(sorted.sort).toBe("-updated_at");
    expect(sorted.params.sort).toBe("-updated_at");

    const sunday = new Date("2026-10-18T15:00:00.000Z");
    expect(shouldFullReconcile(sunday, null)).toBe(true);
    expect(shouldFullReconcile(sunday, "2026-10-18")).toBe(false);
    expect(shouldFullReconcile(new Date("2026-10-16T15:00:00.000Z"), null)).toBe(false);
  });

  it("waits out a nearly empty rate-limit window", () => {
    const now = 1_700_000_000_000;
    expect(paceDelayMs("40", null, now)).toBe(1_100);
    expect(paceDelayMs("0", String(Math.floor(now / 1000) + 5), now)).toBe(5_000);
  });

  it("upserts SQL by primary key", () => {
    expect(ORG_UPSERT).toContain("ON CONFLICT (id) DO UPDATE");
    expect(PROJECT_UPSERT).toContain("ON CONFLICT (id) DO UPDATE");
    const migration = readFileSync(new URL("../db/migrations/0001_sync.sql", import.meta.url), "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS account_snapshots");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS sync_cursors");
  });

  it("rejects a cron request unless the bearer secret matches", () => {
    process.env.CRON_SECRET = "cron-secret-value";
    const allowed = new Request("https://example.com/api/cron/sync", {
      headers: { authorization: "Bearer cron-secret-value" },
    });
    const denied = new Request("https://example.com/api/cron/sync", {
      headers: { authorization: "Bearer other" },
    });
    expect(cronAuthorized(allowed)).toBe(true);
    expect(cronAuthorized(denied)).toBe(false);
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(allowed)).toBe(false);
  });

  it("resumes from the cursor and updates an existing org instead of inserting another", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = "super-secret-password";
    process.env.SUBHUB_AUTH_MODE = "basic";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    let name = "First Roofing";
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/orgs")) {
        if (url.searchParams.has("updated_since")) {
          return new Response(JSON.stringify({ message: "The updated_since field is not allowed." }), {
            status: 422,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.searchParams.get("cursor") === "page-2") {
          return Response.json({
            results: { data: [{ id: "org_b", name: "Second Roofing", updated_at: "2026-02-01T00:00:00.000Z" }], next_cursor: null },
          });
        }
        return Response.json({
          results: {
            data: [{ id: "org_a", name, updated_at: "2026-01-01T00:00:00.000Z" }],
            next_cursor: "page-2",
          },
        });
      }
      return Response.json({ results: { data: [], next_cursor: null } });
    };
    try {
      const first = await runSync({ kind: "backfill", endpoints: ["orgs"], maxPages: 1 });
      expect(first.pending).toBe(true);
      expect(memoryStore()?.orgs.size).toBe(1);
      const second = await runSync({ kind: "backfill", endpoints: ["orgs"], maxPages: 1 });
      expect(second.pending).toBe(false);
      expect([...memoryStore()!.orgs.keys()].sort()).toEqual(["org_a", "org_b"]);

      name = "Renamed Roofing";
      await runSync({ kind: "incremental", endpoints: ["orgs"], maxPages: 4 });
      expect(memoryStore()?.orgs.size).toBe(2);
      expect(memoryStore()?.orgs.get("org_a")?.name).toBe("Renamed Roofing");
      const cursor = await memoryStore()?.getCursor("orgs");
      expect(cursor?.highWater).toBe("2026-02-01T00:00:00.000Z");
      expect(cursor?.unsupportedFilters).toContain("updated_since");
      const runs = await memoryStore()?.listRuns(10);
      expect(runs?.some((run) => run.endpoint === "orgs" && run.error?.includes("422") && run.error.includes("not allowed"))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

function authEnv(): void {
  process.env.SUBHUB_API_USERNAME = "cxm-service";
  process.env.SUBHUB_API_PASSWORD = "super-secret-password";
  process.env.SUBHUB_AUTH_MODE = "basic";
  process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
}

describe("backfill continues after orgs", () => {
  it("runs the next unfinished endpoint and does not restart a finished org backfill", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: false }));
    const paths: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/projects")) {
        return Response.json({
          results: {
            data: [{ id: "proj_1", org_id: "org_a", updated_at: "2026-03-01T00:00:00.000Z" }],
            next_cursor: "projects-2",
          },
        });
      }
      return Response.json({ results: { data: [], next_cursor: null } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 1 });
      expect(paths.some((path) => path.endsWith("/orgs"))).toBe(false);
      expect(paths.some((path) => path.endsWith("/projects"))).toBe(true);
      expect(report.endpoint).toBe("projects");
      expect(report.backfillPending).toBe(true);
      expect(store.projects.size).toBe(1);
      const runs = await store.listRuns(5);
      expect(runs[0]?.endpoint).toBe("projects");
      expect(runs.some((run) => run.endpoint === "orgs")).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("lets the hourly org cron continue an unfinished backfill", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const paths: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      return Response.json({
        results: { data: [{ id: "proj_1", org_id: "org_a" }], next_cursor: "projects-2" },
      });
    };
    try {
      const report = await runSync({ kind: "orgs", maxPages: 1 });
      expect(report.endpoint).toBe("projects");
      expect(report.backfillPending).toBe(true);
      expect(paths.some((path) => path.endsWith("/orgs"))).toBe(false);
      expect(paths.some((path) => path.endsWith("/projects"))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("records a 429 body snippet on the projects run and leaves that cursor incomplete", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      return new Response(JSON.stringify({ message: "Too Many Attempts" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 1 });
      expect(report.pending).toBe(false);
      expect(report.status).toBe("error");
      const run = (await store.listRuns(5)).find((item) => item.endpoint === "projects");
      expect(run?.status).toBe("error");
      expect(run?.error).toContain("429");
      expect(run?.error).toContain("Too Many Attempts");
      expect((await store.getCursor("projects"))?.backfillComplete).toBeFalsy();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("records a 404 body snippet when an optional list is missing", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    await store.saveCursor("projects", freshCursor({ backfillComplete: true, passComplete: true }));
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/financials")) {
        return new Response(JSON.stringify({ message: "The route financials could not be found." }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return Response.json({ results: { data: [], next_cursor: null } });
    };
    try {
      await runSync({ kind: "backfill", maxPages: 4 });
      const run = (await store.listRuns(10)).find((item) => item.endpoint === "financials");
      expect(run?.status).toBe("unsupported");
      expect(run?.error).toContain("404");
      expect(run?.error).toContain("could not be found");
      expect((await store.getCursor("financials"))?.disabled).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

const TIE = "2026-03-31T18:54:00.000Z";

function tiedProjects(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `proj_${index}`,
    org_id: "org_a",
    updated_at: TIE,
  }));
}

describe("project backfill cursor", () => {
  it("keeps walking when many projects share updated_at and the cursor changes", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const rows = tiedProjects(120);
    const cursors: Array<string | null> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/projects")) {
        const cursor = url.searchParams.get("cursor");
        cursors.push(cursor);
        const index = cursor ? Number(cursor) : 0;
        const start = index * 50;
        const next = start + 50 < rows.length ? String(index + 1) : null;
        return Response.json({ results: { data: rows.slice(start, start + 50), next_cursor: next } });
      }
      if (url.pathname.endsWith("/financials")) {
        return Response.json({ results: { data: [{ id: "fin_1", org_id: "org_a" }], next_cursor: null } });
      }
      return Response.json({ results: { data: [], next_cursor: null } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 6 });
      expect(report.status).toBe("ok");
      expect(report.error).toBeNull();
      expect(cursors).toEqual([null, "1", "2"]);
      expect(store.projects.size).toBe(120);
      expect((await store.getCursor("projects"))?.highWater).toBe(TIE);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect(store.financials.size).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not treat a short page with a next cursor as the end of projects", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      return Response.json({
        results: { data: tiedProjects(2), next_cursor: "more" },
      });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 1 });
      expect(report.status).toBe("ok");
      expect(report.rows).toBe(2);
      expect((await store.getCursor("projects"))?.backfillComplete).toBeFalsy();
      expect((await store.getCursor("projects"))?.cursor).toBe("more");
      expect(store.financials.size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("leaves projects on a null next_cursor and moves on to financials", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      if (url.pathname.endsWith("/projects")) {
        return Response.json({ results: { data: tiedProjects(42), next_cursor: null } });
      }
      return Response.json({ results: { data: [], next_cursor: null } });
    };
    try {
      await runSync({ kind: "backfill", maxPages: 4 });
      expect(store.projects.size).toBe(42);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect(seen.some((path) => path.endsWith("/financials"))).toBe(true);
      expect((await store.getCursor("financials"))?.backfillComplete).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("resumes a repeated timestamp cursor by page and does not reset the saved cursor", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const rows = tiedProjects(60);
    const requests: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/financials")) {
        return Response.json({ results: { data: [{ id: "fin_1" }], next_cursor: null } });
      }
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      requests.push(url.search);
      const page = url.searchParams.get("page");
      if (page) {
        const start = (Number(page) - 1) * 50;
        const slice = rows.slice(start, start + 50);
        const next = start + 50 < rows.length ? "2026-03-31T18:54Z" : null;
        return Response.json({ results: { data: slice, next_cursor: next } });
      }
      return Response.json({ results: { data: rows.slice(0, 50), next_cursor: "2026-03-31T18:54Z" } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 6 });
      expect(report.status).toBe("ok");
      expect(report.error).toBeNull();
      expect(requests.some((query) => query.includes("cursor="))).toBe(true);
      expect(requests.some((query) => query.includes("page=2"))).toBe(true);
      expect(store.projects.size).toBe(60);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect((await store.getCursor("projects"))?.highWater).toBe(TIE);
      expect(store.financials.size).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("continues from a saved timestamp cursor without a cursor reset", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const rows = tiedProjects(60);
    await store.upsertProjects(
      rows.slice(0, 50).map((row) => ({
        id: row.id,
        orgId: row.org_id,
        jobType: null,
        systemSize: null,
        isTest: null,
        deletedAt: null,
        createdAt: null,
        updatedAt: TIE,
        raw: row,
      })),
    );
    await store.saveCursor(
      "projects",
      freshCursor({ cursor: "2026-03-31T18:54Z", highWater: TIE, backfillComplete: false }),
    );
    const requests: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      requests.push(url.search);
      const page = url.searchParams.get("page");
      if (page) {
        const start = (Number(page) - 1) * 50;
        return Response.json({ results: { data: rows.slice(start, start + 50), next_cursor: null } });
      }
      return Response.json({ results: { data: rows.slice(0, 50), next_cursor: "2026-03-31T18:54:00.000Z" } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 4 });
      expect(report.status).toBe("ok");
      expect(requests[0]).toContain("cursor=");
      expect(requests.some((query) => query.includes("page=2"))).toBe(true);
      expect(store.projects.size).toBe(60);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect((await store.getCursor("financials"))?.backfillComplete).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("completes a tie when the cursor and the page both return the same projects, then starts financials", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      if (url.pathname.endsWith("/financials")) {
        return Response.json({ results: { data: [{ id: "fin_1", org_id: "org_a" }], next_cursor: null } });
      }
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      return Response.json({ results: { data: tiedProjects(50), next_cursor: "2026-03-31T18:54Z" } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 6 });
      expect(report.status).toBe("ok");
      expect(report.error).toBeNull();
      expect(store.projects.size).toBe(50);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect((await store.getCursor("projects"))?.lastError).toBeNull();
      expect(backfillLabel(await store.getCursor("projects"))).toBe("Complete");
      expect(seen.some((path) => path.endsWith("/financials"))).toBe(true);
      expect(store.financials.size).toBe(1);
      const copy = storedCopyStatus(1, {
        orgs: freshCursor({ backfillComplete: true, passComplete: true }),
        projects: await store.getCursor("projects"),
        financials: await store.getCursor("financials"),
      });
      expect(copy.endpoints.projects.state).toBe("complete");
      expect(copy.endpoints.projects.lastError).toBeNull();
      expect(copy.endpoints.financials.state).toBe("complete");
    } finally {
      globalThis.fetch = original;
    }
  });

  const TAIL = "2026-10-08T13:32:54.000Z";

  it("advances past a shared updated_at with an updated_at|id cursor", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: String(index + 1),
      org_id: "org_a",
      updated_at: TAIL,
    }));
    const cursors: Array<string | null> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/financials")) {
        return Response.json({ results: { data: [{ id: "fin_1", org_id: "org_a" }], next_cursor: null } });
      }
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      let start = 0;
      if (cursor?.includes("|")) {
        const id = cursor.slice(cursor.lastIndexOf("|") + 1);
        const found = rows.findIndex((row) => row.id === id);
        start = found >= 0 ? found + 1 : 0;
      }
      const slice = rows.slice(start, start + 50);
      const next = start + 50 < rows.length ? TAIL : null;
      return Response.json({ results: { data: slice, next_cursor: next } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 6 });
      expect(report.status).toBe("ok");
      expect(report.error).toBeNull();
      expect(cursors.some((cursor) => cursor?.startsWith(`${TAIL}|`))).toBe(true);
      expect(store.projects.size).toBe(120);
      expect((await store.getCursor("projects"))?.highWater).toBe(TAIL);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect(store.financials.size).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("walks by page when the API rejects an updated_at|id cursor", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const rows = tiedProjects(60);
    const requests: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/financials")) {
        return Response.json({ results: { data: [{ id: "fin_1" }], next_cursor: null } });
      }
      if (!url.pathname.endsWith("/projects")) return Response.json({ results: { data: [], next_cursor: null } });
      requests.push(url.search);
      if (url.searchParams.get("cursor")?.includes("|")) {
        return Response.json({ message: "The cursor field is invalid." }, { status: 422 });
      }
      const page = url.searchParams.get("page");
      if (page) {
        const start = (Number(page) - 1) * 50;
        const slice = rows.slice(start, start + 50);
        const next = start + 50 < rows.length ? TIE : null;
        return Response.json({ results: { data: slice, next_cursor: next } });
      }
      return Response.json({ results: { data: rows.slice(0, 50), next_cursor: TIE } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 6 });
      expect(report.status).toBe("ok");
      expect(report.error).toBeNull();
      expect(requests.some((query) => query.includes("page=2"))).toBe(true);
      expect(store.projects.size).toBe(60);
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect(store.financials.size).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("completes the tail when next_cursor resets onto stored rows and does not block the lists behind it", async () => {
    authEnv();
    const store = memoryStore()!;
    await store.saveCursor("orgs", freshCursor({ backfillComplete: true, passComplete: true }));
    const seen: string[] = [];
    let projectCalls = 0;
    let financialCalls = 0;
    const original = globalThis.fetch;
    const repeat = (token: string) => Response.json({ results: { data: tiedProjects(50), next_cursor: token } });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      if (url.pathname.endsWith("/projects")) {
        projectCalls += 1;
        // A new token each time, so a string compare looks like progress, but the rows do not move.
        return repeat(`wrap-${projectCalls}`);
      }
      if (url.pathname.endsWith("/financials")) {
        financialCalls += 1;
        return repeat(`fin-${financialCalls}`);
      }
      if (url.pathname.endsWith("/esign-status")) {
        return Response.json({ results: { data: [{ id: "sign_1", org_id: "org_a" }], next_cursor: null } });
      }
      return Response.json({ results: { data: [], next_cursor: null } });
    };
    try {
      const report = await runSync({ kind: "backfill", maxPages: 8 });
      expect(report.status).toBe("ok");
      expect(report.error).toBeNull();
      expect((await store.getCursor("projects"))?.backfillComplete).toBe(true);
      expect((await store.getCursor("projects"))?.highWater).toBe(TIE);
      expect((await store.getCursor("financials"))?.backfillComplete).toBe(true);
      expect(seen.some((path) => path.endsWith("/financials"))).toBe(true);
      expect(seen.some((path) => path.endsWith("/esign-status"))).toBe(true);
      expect(store.esign.size).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("sync health and cron follow-up", () => {
  it("reports ready only when every cursor is complete", () => {
    const complete = { ...emptyCursor(), backfillComplete: true, passComplete: true };
    const partial = storedCopyStatus(1804, { orgs: complete });
    expect(partial.status).toBe("backfilling");
    expect(partial.endpoints.orgs.state).toBe("complete");
    expect(partial.endpoints.projects.state).toBe("in_progress");
    expect(partial.endpoints.financials.state).toBe("in_progress");
    const finished = Object.fromEntries(ENDPOINTS.map((endpoint) => [endpoint.id, complete]));
    expect(storedCopyStatus(1804, finished).status).toBe("ready");
    expect(storedCopyStatus(0, finished).status).toBe("empty");
    const unsupported = { ...complete, disabled: true, backfillComplete: false };
    const withGap = { ...finished, commissions: unsupported };
    expect(storedCopyStatus(1804, withGap).status).toBe("ready");
    expect(storedCopyStatus(1804, withGap).endpoints.commissions.state).toBe("unsupported");
    expect(partial.endpoints.projects.lastError).toBeNull();
    const stalled = {
      ...emptyCursor(),
      highWater: "2026-03-31T18:54:00.000Z",
      cursor: "2026-03-31T18:54Z",
      lastError: "projects cursor did not advance. The same page came back, so this run stopped instead of repeating it.",
    };
    const stalledCopy = storedCopyStatus(1804, { orgs: complete, projects: stalled });
    expect(stalledCopy.status).toBe("backfilling");
    expect(stalledCopy.endpoints.projects.state).toBe("in_progress");
    expect(stalledCopy.endpoints.projects.lastError).toContain("did not advance");
    expect(backfillLabel(stalled)).toBe("Stalled");
    expect(backfillLabel(complete)).toBe("Complete");
  });

  it("sends the cron secret as a header and reports a blocked follow-up", async () => {
    process.env.CRON_SECRET = "cron-secret-value";
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = "bypass-value";
    const plan = planCronFollowUp("https://cxm.example.com/api/cron/orgs?kind=orgs", 0, "backfill");
    expect(plan?.url).toContain("kind=backfill");
    expect(plan?.url).toContain("hop=1");
    expect(plan?.url).not.toContain("cron-secret-value");
    expect(plan?.url).not.toContain("bypass-value");
    expect(plan?.headers.authorization).toBe("Bearer cron-secret-value");
    expect(plan?.headers["x-vercel-protection-bypass"]).toBe("bypass-value");
    expect(planCronFollowUp("https://cxm.example.com/api/cron/sync", 80, "backfill")).toBeNull();

    const seen: Array<{ authorization: string | null; bypass: string | null }> = [];
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      await dispatchCronFollowUp(plan!, async (_url, init) => {
        const headers = new Headers(init?.headers);
        seen.push({ authorization: headers.get("authorization"), bypass: headers.get("x-vercel-protection-bypass") });
        return new Response("<html><title>Authentication Required cron-secret-value</title></html>", {
          status: 401,
          headers: { "content-type": "text/html" },
        });
      });
    } finally {
      console.error = original;
    }
    expect(seen[0]).toEqual({ authorization: "Bearer cron-secret-value", bypass: "bypass-value" });
    expect(errors[0]).toContain("401");
    expect(errors.join(" ")).not.toContain("cron-secret-value");
    expect(errors.join(" ")).not.toContain("bypass-value");
  });
});
