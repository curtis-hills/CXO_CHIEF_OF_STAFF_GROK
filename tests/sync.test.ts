import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { resetApiSession } from "../lib/api/client";
import { ENDPOINTS } from "../lib/sync/catalog";
import { cronAuthorized } from "../lib/sync/cron";
import { dispatchCronFollowUp, planCronFollowUp } from "../lib/sync/follow";
import { storedCopyStatus } from "../lib/sync/progress";
import { emptyCursor } from "../lib/sync/types";
import {
  advanceHighWater,
  paceDelayMs,
  selectSyncQuery,
  shouldFullReconcile,
  splitAtHighWater,
  upsertById,
} from "../lib/sync/high-water";
import { normalizeOrg } from "../lib/sync/rows";
import { resetSyncInflight, runSync } from "../lib/sync/runner";
import { ORG_UPSERT, PROJECT_UPSERT } from "../lib/sync/postgres-store";
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
