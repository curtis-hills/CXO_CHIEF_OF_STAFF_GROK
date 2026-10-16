import { afterEach, describe, expect, it } from "vitest";
import {
  collectAll,
  collectionFromPayload,
  inspectResponse,
  SubhubApiError,
} from "../lib/api/body";
import { healthPayload } from "../lib/api/health-payload";
import { resetApiSession } from "../lib/api/client";
import { ApiSession, type ApiAuthConfig } from "../lib/api/session";
import { readPortfolio } from "../lib/data/load";

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
    });
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
      const portfolio = await readPortfolio();
      expect(portfolio.mode).toBe("mock");
      expect(portfolio.accounts.length).toBeGreaterThan(0);
      expect(portfolio.notice).toContain("text/html");
      expect(portfolio.notice).toContain('title "Login [redacted]"');
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
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/orgs")) {
        return Response.json({ data: [{ id: "org_live", name: "Live Roofing", status: "launched" }] });
      }
      return Response.json({ projects: [] });
    };
    try {
      const portfolio = await readPortfolio();
      expect(portfolio.mode).toBe("live");
      expect(portfolio.notice).toBeNull();
      expect(portfolio.accounts.map((account) => account.name)).toContain("Live Roofing");
    } finally {
      globalThis.fetch = original;
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
