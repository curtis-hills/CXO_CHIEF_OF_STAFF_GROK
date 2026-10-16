import { afterEach, describe, expect, it } from "vitest";
import {
  collectAll,
  collectionFromPayload,
  inspectResponse,
  SubhubApiError,
} from "../lib/api/body";
import { MAX_PAGES, PAGE_SIZE } from "../lib/api/limits";
import { healthPayload } from "../lib/api/health-payload";
import { MAX_RATE_LIMIT_RETRIES, retryDelayMs } from "../lib/api/rate-limit";
import { fetchOrgs, resetApiSession } from "../lib/api/client";
import { ApiSession, type ApiAuthConfig } from "../lib/api/session";
import { assemblePortfolio } from "../lib/data/assemble";
import { readPortfolio } from "../lib/data/load";
import { resetSyncInflight, runSync } from "../lib/sync/runner";
import { resetMemoryStore } from "../lib/sync/store";

const PASSWORD = "super-secret-password";
const API_KEY = "svc-key-9f3c";
const EMAIL = "ada@example.com";

function config(overrides: Partial<ApiAuthConfig> = {}): ApiAuthConfig {
  return {
    baseUrl: "https://app.subcontractorhub.com",
    apiKey: "",
    username: "cxm-service",
    password: PASSWORD,
    mode: "basic",
    keyHeader: "X-API-Key",
    loginPath: "",
    loginUsernameField: "email",
    loginPasswordField: "password",
    loginKeyField: "key",
    loginDeviceName: "cxm-dashboard",
    ...overrides,
  };
}

describe("rate limit wait", () => {
  it("honors Retry-After and X-RateLimit-Reset, then backs off", () => {
    const now = 1_700_000_000_000;
    expect(retryDelayMs(headers({ "retry-after": "2" }), 1, now)).toBe(2_000);
    expect(retryDelayMs(headers({ "retry-after": "0" }), 1, now)).toBe(0);
    expect(retryDelayMs(headers({ "retry-after": new Date(now + 5_000).toUTCString() }), 1, now)).toBe(5_000);
    expect(retryDelayMs(headers({ "x-ratelimit-reset": String(Math.floor(now / 1000) + 3) }), 1, now)).toBe(3_000);
    expect(retryDelayMs(headers({ "retry-after": "999999" }), 1, now)).toBe(60_000);
    expect(retryDelayMs(new Headers(), 1, now, () => 0)).toBe(500);
    expect(retryDelayMs(new Headers(), 2, now, () => 0)).toBe(1_000);
    expect(retryDelayMs(new Headers(), 3, now, () => 0)).toBe(2_000);
  });
});

describe("API response shapes", () => {
  it("reads common list wrappers and Laravel pagination", async () => {
    expect(collectionFromPayload([{ id: 1 }])?.items).toEqual([{ id: 1 }]);
    expect(collectionFromPayload({ data: [{ id: 2 }] })?.items).toEqual([{ id: 2 }]);
    expect(collectionFromPayload({ orgs: [{ id: 3 }] })?.items).toEqual([{ id: 3 }]);
    expect(collectionFromPayload({ results: [{ id: 4 }] })?.items).toEqual([{ id: 4 }]);
    expect(collectionFromPayload({ results: { data: [{ id: 5 }], next_cursor: "n5" } })).toEqual({
      items: [{ id: 5 }],
      next: { cursor: "n5" },
    });
    expect(
      collectionFromPayload({
        results: {
          data: [{ id: 6 }],
          next_cursor: null,
          next_page_url: "https://app.subcontractorhub.com/api/v1/superadmin/orgs?cursor=from-url",
        },
      })?.next,
    ).toEqual({ cursor: "from-url" });

    const pages = [
      {
        data: [{ id: "a" }],
        links: { next: "https://app.subcontractorhub.com/api/v1/superadmin/orgs?page=2" },
        meta: { current_page: 1, last_page: 2, per_page: 1 },
      },
      { data: [{ id: "b" }], links: { next: null }, meta: { current_page: 2, last_page: 2 } },
    ];
    const seen: Array<number | undefined> = [];
    const items = await collectAll<{ id: string }>(async (query) => {
      seen.push(query.page);
      return pages[(query.page ?? 1) - 1];
    });
    expect(items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(seen).toEqual([undefined, 2]);
  });

  it("uses limit 50 and follows next_cursor through 2000 rows, then stops at the page cap", async () => {
    expect(PAGE_SIZE).toBe(50);
    expect(PAGE_SIZE).toBeLessThanOrEqual(50);
    expect(MAX_PAGES).toBeGreaterThanOrEqual(40);
    expect(PAGE_SIZE * MAX_PAGES).toBeGreaterThanOrEqual(2000);

    const cursors: Array<string | undefined> = [];
    const items = await collectAll<{ id: number }>(async (query) => {
      cursors.push(query.cursor);
      const index = query.cursor ? Number(query.cursor) : 0;
      const start = index * PAGE_SIZE;
      const nextIndex = index + 1;
      return {
        results: {
          data: Array.from({ length: PAGE_SIZE }, (_, offset) => ({ id: start + offset })),
          next_cursor: nextIndex < MAX_PAGES + 5 ? String(nextIndex) : null,
        },
      };
    });
    expect(cursors).toHaveLength(MAX_PAGES);
    expect(cursors[0]).toBeUndefined();
    expect(cursors[MAX_PAGES - 1]).toBe(String(MAX_PAGES - 1));
    expect(items).toHaveLength(PAGE_SIZE * MAX_PAGES);
    expect(items.length).toBeGreaterThanOrEqual(2000);
  });

  it("describes an HTML 200 without credentials or email addresses", () => {
    const html = `<!doctype html><html><head><title>Login ${PASSWORD} ${EMAIL}</title></head><body><form><input type="password" name="password" value="${PASSWORD}"><p>${EMAIL}</p><p>Acme Solar Secret</p></form></body></html>`;
    const { summary } = inspectResponse("text/html; charset=UTF-8", html, [PASSWORD, API_KEY]);
    const error = new SubhubApiError(200, "/api/v1/superadmin/orgs", summary);
    expect(error.message).toContain("returned 200");
    expect(error.message).toContain("text/html");
    expect(error.message).toContain("html");
    expect(error.message).toContain('title "Login [redacted] [redacted-email]"');
    expect(error.message).toContain("markers: doctype, html, form, password-field, login");
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain(EMAIL);
    expect(error.message).not.toContain("Acme Solar Secret");
    expect(error.topLevelKeys).toEqual([]);
    expect(error.recordCount).toBeNull();
  });

  it("describes unexpected JSON by keys and a sanitized message", () => {
    const { summary } = inspectResponse(
      "application/json",
      JSON.stringify({ message: `nope ${PASSWORD}`, email: EMAIL, account: "Acme Solar Secret" }),
      [PASSWORD],
    );
    const error = new SubhubApiError(200, "/api/v1/superadmin/orgs", summary);
    expect(summary.topLevelKeys).toEqual(["message", "email", "account"]);
    expect(summary.recordCount).toBeNull();
    expect(error.message).toContain("keys: message, email, account");
    expect(error.message).toContain("message: nope [redacted]");
    expect(error.message).not.toContain(PASSWORD);
    expect(error.message).not.toContain(EMAIL);
    expect(error.message).not.toContain("Acme Solar Secret");
  });

  it("reports the tried mode, content type, keys, and record count from /api/health", async () => {
    const html = `<!doctype html><title>Sign in</title><form><input type="password"></form>`;
    const htmlSession = new ApiSession(config(), async () => {
      return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    });
    const htmlReport = await htmlSession.probe();
    const htmlBody = healthPayload(htmlReport);
    expect(htmlBody).toMatchObject({
      status: "unexpected body",
      mode: "basic",
      upstreamStatus: 200,
      contentType: "text/html",
      bodyKind: "html",
      topLevelKeys: [],
      recordCount: null,
    });
    expect(String(htmlBody.detail)).toContain('title "Sign in"');
    expect(JSON.stringify(htmlBody)).not.toContain(PASSWORD);

    const jsonSession = new ApiSession(config(), async () => {
      return new Response(JSON.stringify({ data: [{ id: 1 }, { id: 2 }], links: {}, meta: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const jsonBody = healthPayload(await jsonSession.probe());
    expect(jsonBody).toMatchObject({
      status: "connected",
      mode: "basic",
      upstreamStatus: 200,
      contentType: "application/json",
      bodyKind: "json",
      topLevelKeys: ["data", "links", "meta"],
      recordCount: 2,
      hasNextCursor: false,
    });

    const cursor = "cursor-secret-9f3c";
    const nested = new ApiSession(config(), async (url) => {
      expect(new URL(url).searchParams.get("limit")).toBe("50");
      return new Response(
        JSON.stringify({
          results: {
            data: [{ id: 1 }, { id: 2 }, { id: 3 }],
            next_cursor: cursor,
            next_page_url: `https://app.subcontractorhub.com/api/v1/superadmin/orgs?cursor=${cursor}`,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const nestedBody = healthPayload(await nested.probe());
    expect(nestedBody).toMatchObject({
      status: "connected",
      topLevelKeys: ["results"],
      recordCount: 3,
      hasNextCursor: true,
    });
    expect(JSON.stringify(nestedBody)).not.toContain(cursor);

    const wrapped = inspectResponse(
      "application/json",
      JSON.stringify({ results: { path: "/api/v1/superadmin/orgs", per_page: 1 } }),
    );
    expect(wrapped.summary.recordCount).toBeNull();
    expect(wrapped.summary.hasNextCursor).toBe(false);
  });
});

describe("documented org payload", () => {
  it("follows results.next_cursor with the cursor query parameter", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "login";
    process.env.SUBHUB_LOGIN_PATH = "/api/v1/login";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "POST") return Response.json({ token: "cached-token" });
      if (!url.includes("cursor=")) {
        return Response.json({
          results: {
            data: [{ id: "org_a", name: "First" }],
            path: "https://app.subcontractorhub.com/api/v1/superadmin/orgs",
            per_page: 50,
            next_cursor: "cursor-1",
            next_page_url: "https://app.subcontractorhub.com/api/v1/superadmin/orgs?cursor=cursor-1",
            prev_cursor: null,
            prev_page_url: null,
          },
        });
      }
      return Response.json({
        results: {
          data: [{ id: "org_b", name: "Second" }],
          next_cursor: null,
          next_page_url: null,
          prev_cursor: "cursor-1",
          prev_page_url: null,
        },
      });
    };
    try {
      const orgs = await fetchOrgs();
      expect(orgs.map((org) => org.id)).toEqual(["org_a", "org_b"]);
      const orgGets = urls.filter((url) => url.includes("/superadmin/orgs"));
      expect(orgGets[0]).not.toContain("cursor=");
      expect(orgGets[1]).toContain("cursor=cursor-1");
    } finally {
      globalThis.fetch = original;
      delete process.env.SUBHUB_API_USERNAME;
      delete process.env.SUBHUB_API_PASSWORD;
      delete process.env.SUBHUB_API_KEY;
      delete process.env.SUBHUB_AUTH_MODE;
      delete process.env.SUBHUB_LOGIN_PATH;
      delete process.env.SUBHUB_API_BASE_URL;
      resetApiSession();
    }
  });

  it("maps flat address fields and the documented plan names", () => {
    const assembled = assemblePortfolio({
      mode: "live",
      asOf: "2026-10-16T00:00:00.000Z",
      orgs: [
        {
          id: 9,
          name: "Northwind Solar",
          email: "ops@northwind.example",
          status: "Launched",
          payment_status: "paid",
          street: "1 Main St",
          city: "Phoenix",
          state: "AZ",
          postal_code: "85001",
          country: "US",
          products: ["Solar"],
          active_user_count: 3,
          subscriptions: [
            { status: "active", plan: { id: 1, name: "Sales and Referrals Monthly", unit_price: 500, interval: "month" } },
            { status: "active", plan: { id: 2, name: "Solar Per Contract Sign", unit_price: "35.00", interval: null } },
          ],
        },
      ],
      projectsByOrg: { "9": [] },
      proxies: {},
      overrides: {},
    });
    const account = assembled.accounts[0];
    expect(account?.city).toBe("Phoenix");
    expect(account?.state).toBe("AZ");
    expect(account?.postalCode).toBe("85001");
    expect(account?.street).toBe("1 Main St");
    expect(account?.country).toBe("US");
    expect(account?.accountType).toBe("sales_org");
    expect(account?.subscriptions).toEqual([
      { status: "active", planName: "Sales and Referrals Monthly", unitPrice: 500, interval: "month" },
      { status: "active", planName: "Solar Per Contract Sign", unitPrice: 35, interval: "contract" },
    ]);
  });
});

describe("page fallback", () => {
  const previous = {
    username: process.env.SUBHUB_API_USERNAME,
    password: process.env.SUBHUB_API_PASSWORD,
    key: process.env.SUBHUB_API_KEY,
    mode: process.env.SUBHUB_AUTH_MODE,
    base: process.env.SUBHUB_API_BASE_URL,
  };

  afterEach(() => {
    restore("SUBHUB_API_USERNAME", previous.username);
    restore("SUBHUB_API_PASSWORD", previous.password);
    restore("SUBHUB_API_KEY", previous.key);
    restore("SUBHUB_AUTH_MODE", previous.mode);
    restore("SUBHUB_API_BASE_URL", previous.base);
    resetApiSession();
    resetMemoryStore();
    resetSyncInflight();
  });

  it("keeps every page on labeled demo data when the API returns HTML", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "basic";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        `<!doctype html><html><title>Login ${PASSWORD}</title><form><input type="password"><p>${EMAIL}</p></form></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    try {
      const report = await runSync({ kind: "backfill", endpoints: ["orgs"], maxPages: 2 });
      expect(report.status).toBe("error");
      expect(report.error).toContain("text/html");
      expect(report.error).toContain('title "Login [redacted]"');
      expect(report.error).not.toContain(PASSWORD);
      expect(report.error).not.toContain(EMAIL);
      const portfolio = await readPortfolio();
      expect(portfolio.mode).toBe("mock");
      expect(portfolio.accounts.length).toBeGreaterThan(0);
      expect(portfolio.notice).not.toContain(PASSWORD);
      expect(portfolio.notice).not.toContain(EMAIL);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reads a data array instead of treating it as a failure", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "basic";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes("/orgs")) {
        return Response.json({ data: [{ id: "org_live", name: "Live Roofing", status: "launched" }] });
      }
      return Response.json({ projects: [] });
    };
    try {
      await runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 4 });
      const afterSync = calls;
      const portfolio = await readPortfolio();
      expect(calls).toBe(afterSync);
      expect(portfolio.mode).toBe("live");
      expect(portfolio.notice).toBeNull();
      expect(portfolio.accounts.map((account) => account.name)).toContain("Live Roofing");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("caches the crawl and groups one project list by org id", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "basic";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/orgs")) {
        return Response.json({
          results: { data: [{ id: "org_live", name: "Live Roofing", status: "launched" }], next_cursor: null },
        });
      }
      if (url.includes("org_id=")) throw new Error("per-org project fetch");
      return Response.json({
        results: { data: [{ id: "p1", org_id: "org_live" }], next_cursor: null },
      });
    };
    try {
      await runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 4 });
      const afterSync = urls.length;
      const first = await readPortfolio();
      const second = await readPortfolio();
      expect(first.mode).toBe("live");
      expect(second.accounts.map((account) => account.id)).toEqual(first.accounts.map((account) => account.id));
      expect(urls.filter((url) => url.includes("/orgs"))).toHaveLength(1);
      expect(urls.filter((url) => url.includes("/projects"))).toHaveLength(1);
      expect(urls.some((url) => url.includes("org_id="))).toBe(false);
      expect(urls).toHaveLength(afterSync);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("asks each org for projects when the unfiltered list is empty", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "basic";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    const urls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/orgs")) {
        return Response.json({ results: { data: [{ id: "org_live", name: "Live Roofing" }] } });
      }
      if (url.includes("org_id=org_live")) {
        return Response.json({ results: { data: [{ id: "p1", org_id: "org_live" }] } });
      }
      return Response.json({ results: { data: [] } });
    };
    try {
      const portfolio = await runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 6 }).then(() => readPortfolio());
      expect(portfolio.mode).toBe("live");
      expect(urls.some((url) => url.includes("/projects") && !url.includes("org_id="))).toBe(true);
      expect(urls.some((url) => url.includes("org_id=org_live"))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("loads per-org projects one at a time", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "basic";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    let inFlight = 0;
    let maxInFlight = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/orgs")) {
        return Response.json({
          results: {
            data: [
              { id: "org_a", name: "Alpha Roofing" },
              { id: "org_b", name: "Beta Roofing" },
            ],
          },
        });
      }
      if (!url.includes("org_id=")) return Response.json({ results: { data: [] } });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      const orgId = new URL(url).searchParams.get("org_id");
      return Response.json({ results: { data: [{ id: `p-${orgId}`, org_id: orgId }] } });
    };
    try {
      const portfolio = await runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 8 }).then(() => readPortfolio());
      expect(maxInFlight).toBe(1);
      expect(portfolio.mode).toBe("live");
      expect(portfolio.accounts.map((account) => account.name).sort()).toEqual(["Alpha Roofing", "Beta Roofing"]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("retries a 429 without logging in again, then keeps real orgs when projects stay limited", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "login";
    process.env.SUBHUB_LOGIN_PATH = "/api/auth/login";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    let logins = 0;
    let projectAttempts = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        logins += 1;
        return Response.json({ token: "cached-token-429", expiry: Math.floor(Date.now() / 1000) + 3600 });
      }
      if (url.includes("/orgs")) {
        return Response.json({ results: { data: [{ id: "org_live", name: "Live Roofing", status: "launched" }] } });
      }
      projectAttempts += 1;
      if (projectAttempts === 1) {
        return new Response(JSON.stringify({ message: "Too Many Attempts" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 30),
          },
        });
      }
      return Response.json({ results: { data: [{ id: "p1", org_id: "org_live" }] } });
    };
    try {
      const recovered = await runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 6 }).then(() => readPortfolio());
      expect(logins).toBe(1);
      expect(projectAttempts).toBe(2);
      expect(recovered.mode).toBe("live");
      expect(recovered.projectsAvailable).toBe(true);
      expect(recovered.accounts.map((account) => account.name)).toEqual(["Live Roofing"]);
      expect(recovered.notice).toBeNull();

      resetApiSession();
      resetMemoryStore();
      resetSyncInflight();
      logins = 0;
      projectAttempts = 0;
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if ((init?.method ?? "GET") === "POST") {
          logins += 1;
          return Response.json({ token: "cached-token-429", expiry: Math.floor(Date.now() / 1000) + 3600 });
        }
        if (url.includes("/orgs")) {
          return Response.json({ results: { data: [{ id: "org_live", name: "Live Roofing", status: "Onboarding" }] } });
        }
        projectAttempts += 1;
        return new Response(JSON.stringify({ message: "Too Many Attempts" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
          },
        });
      };
      const partial = await runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 6 }).then(() => readPortfolio());
      expect(logins).toBe(1);
      expect(projectAttempts).toBe(MAX_RATE_LIMIT_RETRIES + 1);
      expect(partial.mode).toBe("live");
      expect(partial.projectsAvailable).toBe(false);
      expect(partial.accounts.map((account) => account.name)).toEqual(["Live Roofing"]);
      expect(partial.accounts[0]?.projects).toEqual([]);
      expect(partial.accounts[0]?.pace).toBeNull();
      expect(partial.accounts[0]?.health.band).toBe("unscored");
      expect(partial.notice).toContain("Projects could not be loaded");
      expect(partial.notice).not.toContain("cached-token-429");
      expect(partial.notice).not.toContain(PASSWORD);
      expect(partial.accounts.some((account) => account.name === "Horizon Sales Partners")).toBe(false);
      expect(partial.dataAsOf).toBeTruthy();
    } finally {
      globalThis.fetch = original;
      delete process.env.SUBHUB_LOGIN_PATH;
    }
  });

  it("shares one crawl and serves the last snapshot when a later refresh fails", async () => {
    process.env.SUBHUB_API_USERNAME = "cxm-service";
    process.env.SUBHUB_API_PASSWORD = PASSWORD;
    process.env.SUBHUB_API_KEY = "";
    process.env.SUBHUB_AUTH_MODE = "login";
    process.env.SUBHUB_LOGIN_PATH = "/api/auth/login";
    process.env.SUBHUB_API_BASE_URL = "https://app.subcontractorhub.com";
    resetApiSession();
    let logins = 0;
    let orgCalls = 0;
    let refreshAttempts = 0;
    let fail = false;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        logins += 1;
        return Response.json({ token: "cached-token-snap", expiry: Math.floor(Date.now() / 1000) + 3600 });
      }
      if (fail) {
        refreshAttempts += 1;
        throw new Error("upstream down");
      }
      if (url.includes("/orgs")) {
        orgCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return Response.json({ results: { data: [{ id: "org_live", name: "Live Roofing", status: "Onboarding" }] } });
      }
      return Response.json({ results: { data: [{ id: "p1", org_id: "org_live" }] } });
    };
    try {
      const [firstRun, secondRun] = await Promise.all([
        runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 6 }),
        runSync({ kind: "backfill", endpoints: ["orgs", "projects"], maxPages: 6 }),
      ]);
      expect(firstRun.rows).toBe(secondRun.rows);
      const first = await readPortfolio();
      const second = await readPortfolio();
      expect(first.mode).toBe("live");
      expect(second.accounts.map((account) => account.id)).toEqual(first.accounts.map((account) => account.id));
      expect(orgCalls).toBe(1);
      expect(logins).toBe(1);
      const dataAsOf = first.dataAsOf;
      fail = true;
      await runSync({ kind: "incremental", endpoints: ["orgs", "projects"], maxPages: 2 });
      const stale = await readPortfolio();
      expect(stale.mode).toBe("live");
      expect(stale.accounts.map((account) => account.name)).toEqual(["Live Roofing"]);
      expect(stale.dataAsOf).toBe(dataAsOf);
      expect(stale.notice ?? "").not.toContain("cached-token-snap");
      expect(stale.accounts.some((account) => account.name === "Horizon Sales Partners")).toBe(false);
      const held = await readPortfolio();
      expect(held.dataAsOf).toBe(dataAsOf);
      expect(refreshAttempts).toBe(1);
      expect(orgCalls).toBe(1);
      expect(logins).toBe(1);
    } finally {
      globalThis.fetch = original;
      delete process.env.SUBHUB_LOGIN_PATH;
    }
  });
});

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
