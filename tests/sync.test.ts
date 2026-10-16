import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cronAuthorized } from "../lib/sync/cron";
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
import { memoryStore, resetMemoryStore } from "../lib/sync/store";

afterEach(() => {
  resetMemoryStore();
  resetSyncInflight();
  delete process.env.SUBHUB_API_USERNAME;
  delete process.env.SUBHUB_API_PASSWORD;
  delete process.env.SUBHUB_API_KEY;
  delete process.env.SUBHUB_AUTH_MODE;
  delete process.env.SUBHUB_API_BASE_URL;
  delete process.env.CRON_SECRET;
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
    } finally {
      globalThis.fetch = original;
    }
  });
});
