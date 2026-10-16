import { beforeEach, describe, expect, it } from "vitest";
import { healthPayload } from "../lib/api/health-payload";
import {
  ApiSession,
  basicAuthorization,
  readApiAuthConfig,
  redactSecrets,
  resetProcessMemory,
  resolveTokenExpiry,
  type ApiAuthConfig,
} from "../lib/api/session";

const PASSWORD = "super-secret-password";
const API_KEY = "svc-key-9f3c";

function config(overrides: Partial<ApiAuthConfig> = {}): ApiAuthConfig {
  return {
    baseUrl: "https://app.subcontractorhub.com",
    apiKey: API_KEY,
    username: "cxm-service",
    password: PASSWORD,
    mode: "auto",
    keyHeader: "X-API-Key",
    loginPath: "",
    loginUsernameField: "email",
    loginPasswordField: "password",
    loginKeyField: "",
    loginDeviceName: "",
    ...overrides,
  };
}

function headersOf(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

describe("API auth", () => {
  beforeEach(() => {
    resetProcessMemory();
  });

  it("defaults the base URL to the production app host", () => {
    expect(readApiAuthConfig({}).baseUrl).toBe("https://app.subcontractorhub.com");
    expect(readApiAuthConfig({}).mode).toBe("auto");
  });

  it("sends a bearer token when that mode is selected", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const session = new ApiSession(
      config({ mode: "bearer", username: "", password: "" }),
      async (url, init) => {
        calls.push({ url, init });
        return json({ results: { data: [] } });
      },
    );
    const report = await session.probe();
    expect(report).toMatchObject({
      status: "connected",
      mode: "bearer",
      httpStatus: 200,
      bodyKind: "json",
      recordCount: 0,
      hasNextCursor: false,
    });
    expect(headersOf(calls[0]?.init).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]?.url).toContain("https://app.subcontractorhub.com/api/v1/superadmin/orgs");
    expect(new URL(calls[0]?.url ?? "").searchParams.get("limit")).toBe("50");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends HTTP Basic auth", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const session = new ApiSession(
      config({ mode: "basic", apiKey: "" }),
      async (url, init) => {
        calls.push({ url, init });
        return json({ results: { data: [] } });
      },
    );
    const report = await session.probe();
    expect(report.mode).toBe("basic");
    const authorization = headersOf(calls[0]?.init).get("authorization");
    expect(authorization).toBe(basicAuthorization("cxm-service", PASSWORD));
    expect(authorization).not.toContain(PASSWORD);
    expect(calls[0]?.url).not.toContain(PASSWORD);
  });

  it("sends Basic auth plus the key in a separate header", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const session = new ApiSession(
      config({ mode: "basic+key", keyHeader: "X-Subhub-Key" }),
      async (url, init) => {
        calls.push({ url, init });
        return json({ results: { data: [] } });
      },
    );
    const report = await session.probe();
    expect(report).toMatchObject({ status: "connected", mode: "basic+key", httpStatus: 200, bodyKind: "json" });
    const headers = headersOf(calls[0]?.init);
    expect(headers.get("authorization")).toBe(basicAuthorization("cxm-service", PASSWORD));
    expect(headers.get("authorization")).not.toMatch(/^Bearer /);
    expect(headers.get("x-subhub-key")).toBe(API_KEY);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    expect(JSON.stringify(report)).not.toContain(API_KEY);
  });

  it("auto logs in with Sanctum when username and password are set, and uses bearer when only the key is set", async () => {
    const posts: string[] = [];
    const login = new ApiSession(config({ apiKey: "" }), async (url, init) => {
      expect(headersOf(init).get("accept")).toBe("application/json");
      if ((init?.method ?? "GET") === "POST") {
        posts.push(new URL(url).pathname);
        expect(JSON.parse(String(init?.body))).toEqual({ email: "cxm-service", password: PASSWORD });
        return json({ token: "cached-token-1" });
      }
      expect(headersOf(init).get("authorization")).toBe("Bearer cached-token-1");
      return json({ results: { data: [] } });
    });
    const bearer = new ApiSession(config({ username: "", password: "" }), async (_url, init) => {
      expect(headersOf(init).get("accept")).toBe("application/json");
      expect(headersOf(init).get("authorization")).toBe(`Bearer ${API_KEY}`);
      return json({ results: { data: [] } });
    });
    expect((await login.probe()).mode).toBe("login");
    expect(posts).toEqual(["/api/auth/login"]);
    expect((await bearer.probe()).mode).toBe("bearer");
  });

  it("stops after a 401 from the first login path", async () => {
    const posts: string[] = [];
    const session = new ApiSession(config({ apiKey: "" }), async (url, init) => {
      if ((init?.method ?? "GET") === "POST") posts.push(new URL(url).pathname);
      return new Response(JSON.stringify({ message: PASSWORD }), { status: 401, headers: { "content-type": "application/json" } });
    });
    const report = await session.probe();
    expect(report).toMatchObject({ status: "auth failed", httpStatus: 401, mode: "login" });
    expect(posts).toEqual(["/api/auth/login"]);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
  });

  it("tries the configured login path first, then the defaults, and reports them without the token", async () => {
    const posts: string[] = [];
    const session = new ApiSession(config({ apiKey: "", loginPath: "/custom/login" }), async (url, init) => {
      expect(headersOf(init).get("accept")).toBe("application/json");
      if ((init?.method ?? "GET") === "POST") {
        const path = new URL(url).pathname;
        posts.push(path);
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({ email: "cxm-service", password: PASSWORD });
        if (path === "/custom/login") {
          return new Response("<html><title>Login</title><form></form></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        if (path === "/api/auth/login") return new Response("missing", { status: 404, headers: { "content-type": "application/json" } });
        if (path === "/api/login") return json({ data: { access_token: "sanctum-plain-9f3c" } });
        return new Response("no", { status: 404 });
      }
      expect(headersOf(init).get("authorization")).toBe("Bearer sanctum-plain-9f3c");
      return json({
        results: {
          data: [{ id: 1 }],
          next_cursor: null,
          next_page_url: null,
        },
      });
    });
    const report = await session.probe();
    expect(posts).toEqual(["/custom/login", "/api/auth/login", "/api/login"]);
    expect(report).toMatchObject({ status: "connected", mode: "login", loginPath: "/api/login" });
    expect(report.loginAttempts).toEqual([
      expect.objectContaining({ path: "/custom/login", upstreamStatus: 200, contentType: "text/html", bodyKind: "html" }),
      expect.objectContaining({ path: "/api/auth/login", upstreamStatus: 404, bodyKind: "text" }),
      expect.objectContaining({ path: "/api/login", upstreamStatus: 200, contentType: "application/json", topLevelKeys: ["data"] }),
    ]);
    expect(JSON.stringify(report)).not.toContain("sanctum-plain-9f3c");
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    const pasted = healthPayload(report);
    expect(pasted.loginPath).toBe("/api/login");
    expect(pasted.loginAttempts).toHaveLength(3);
    expect(JSON.stringify(pasted)).not.toContain("sanctum-plain-9f3c");
  });

  it("caches the Sanctum token and re-logins only once after a 401", async () => {
    let logins = 0;
    const seen: string[] = [];
    const session = new ApiSession(config({ mode: "login", loginPath: "/api/login" }), async (url, init) => {
      if (url.endsWith("/api/login")) {
        logins += 1;
        return json({ token: `token-${logins}` });
      }
      const authorization = headersOf(init).get("authorization") ?? "";
      seen.push(authorization);
      if (authorization === "Bearer token-1") return new Response("expired", { status: 401 });
      return json({ results: { data: [] } });
    });

    const first = await session.probe();
    const second = await session.probe();
    expect(first).toMatchObject({ status: "connected", mode: "login" });
    expect(second.status).toBe("connected");
    expect(logins).toBe(2);
    expect(seen).toEqual(["Bearer token-1", "Bearer token-2", "Bearer token-2"]);
  });

  it("does not re-login a third time when the refreshed token is also rejected", async () => {
    let logins = 0;
    const session = new ApiSession(config({ mode: "login" }), async (url) => {
      if (url.endsWith("/api/auth/login")) {
        logins += 1;
        return json({ token: `token-${logins}` });
      }
      return new Response("no", { status: 401 });
    });
    const report = await session.probe();
    expect(report).toMatchObject({ status: "auth failed", httpStatus: 401, mode: "login" });
    expect(logins).toBe(2);
  });

  it("shares one in-flight login across parallel requests", async () => {
    let logins = 0;
    const session = new ApiSession(config({ mode: "login" }), async (url) => {
      if (url.endsWith("/api/auth/login")) {
        logins += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json({ token: "shared-token" });
      }
      return json({ results: { data: [] } });
    });
    const [a, b] = await Promise.all([session.probe(), session.probe()]);
    expect(a.status).toBe("connected");
    expect(b.status).toBe("connected");
    expect(logins).toBe(1);
  });

  it("redacts secrets from transport errors and login failures", async () => {
    const exploding = new ApiSession(config({ mode: "bearer", username: "", password: "" }), async () => {
      throw new Error(`connect failed for ${API_KEY}`);
    });
    await expect(exploding.request("/api/v1/superadmin/orgs")).rejects.toThrow("[redacted]");
    await expect(exploding.request("/api/v1/superadmin/orgs")).rejects.toThrow(/^(?!.*svc-key-9f3c)/);
    await expect(exploding.probe()).resolves.toMatchObject({ status: "auth failed", httpStatus: 503 });

    const login = new ApiSession(config({ mode: "login" }), async (url) => {
      if (url.endsWith("/api/auth/login")) {
        return new Response(JSON.stringify({ message: PASSWORD, token: API_KEY }), { status: 401 });
      }
      return new Response("no", { status: 401 });
    });
    await expect(login.request("/api/v1/superadmin/orgs")).rejects.toThrow(
      "SubcontractorHub API rejected the configured credentials.",
    );
    expect(redactSecrets(`token ${API_KEY}`, [API_KEY])).toBe("token [redacted]");
  });

  it("stays on demo data when no credentials are configured", async () => {
    let called = false;
    const session = new ApiSession(
      config({ apiKey: "", username: "", password: "", mode: "auto" }),
      async () => {
        called = true;
        return json({});
      },
    );
    expect(await session.probe()).toEqual({ status: "demo", httpStatus: 200 });
    expect(called).toBe(false);
  });

  it("reports auth failed when an explicit mode is missing credentials", async () => {
    const session = new ApiSession(config({ mode: "basic", username: "", password: "" }), async () => json({}));
    expect(await session.probe()).toEqual({ status: "auth failed", httpStatus: 401 });
  });

  it("keeps a token until its expiry, then logs in again", async () => {
    let logins = 0;
    const fresh = new ApiSession(config({ mode: "login", loginPath: "/api/auth/login" }), async (url, init) => {
      if ((init?.method ?? "GET") === "POST") {
        logins += 1;
        return json({ token: `token-${logins}`, expiry: Math.floor(Date.now() / 1000) + 3600, persistent: true });
      }
      return json({ results: { data: [{ id: 1 }, { id: 2 }], next_cursor: null } });
    });
    expect((await fresh.probe()).recordCount).toBe(2);
    expect((await fresh.probe()).hasNextCursor).toBe(false);
    expect(logins).toBe(1);

    logins = 0;
    const stale = new ApiSession(config({ mode: "login", loginPath: "/api/auth/login", username: "cxm-stale" }), async (_url, init) => {
      if ((init?.method ?? "GET") === "POST") {
        logins += 1;
        return json({ token: `token-${logins}`, expiry: 1_600_000_000 });
      }
      return json({ results: { data: [] } });
    });
    expect((await stale.probe()).status).toBe("connected");
    expect((await stale.probe()).status).toBe("connected");
    expect(logins).toBe(2);
  });

  it("reads expiry as a timestamp, a duration, a date, or a persistent flag", () => {
    const now = 1_700_000_000_000;
    expect(resolveTokenExpiry({ expiry: 1_700_003_600 }, now)).toBe(1_700_003_600_000 - 60_000);
    expect(resolveTokenExpiry({ expiry: now + 3_600_000 }, now)).toBe(now + 3_600_000 - 60_000);
    expect(resolveTokenExpiry({ expiry: 3600 }, now)).toBe(now + 3_600_000 - 60_000);
    expect(resolveTokenExpiry({ expiry: "3600" }, now)).toBe(now + 3_600_000 - 60_000);
    expect(resolveTokenExpiry({ expiry: new Date(now + 3_600_000).toISOString() }, now)).toBe(now + 3_600_000 - 60_000);
    expect(resolveTokenExpiry({ expiry: 90 }, now)).toBe(now + 90_000);
    expect(resolveTokenExpiry({ persistent: true }, now)).toBe(now + 12 * 60 * 60 * 1000);
    expect(resolveTokenExpiry({ token: "abc" }, now)).toBe(now + 60 * 60 * 1000);
  });

  it("retries a 429 using the rate-limit headers and keeps the cached token", async () => {
    let logins = 0;
    let gets = 0;
    const session = new ApiSession(config({ mode: "login", apiKey: "", loginPath: "/api/auth/login" }), async (url, init) => {
      if ((init?.method ?? "GET") === "POST") {
        logins += 1;
        expect(new URL(url).pathname).toBe("/api/auth/login");
        return json({ token: "cached-token-429", expiry: Math.floor(Date.now() / 1000) + 3600 });
      }
      gets += 1;
      if (gets === 1) {
        return new Response(JSON.stringify({ message: "Too Many Attempts" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1700003600",
          },
        });
      }
      return json({ results: { data: [{ id: 1 }, { id: 2 }], next_cursor: null } }, 200, {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "59",
      });
    });
    const report = await session.probe();
    const again = await session.probe();
    expect(report.status).toBe("connected");
    expect(again.status).toBe("connected");
    expect(logins).toBe(1);
    expect(gets).toBe(3);
    expect(report.rateLimit).toEqual({
      retryAfter: "0",
      limit: "60",
      remaining: "0",
      reset: "1700003600",
      status: 429,
    });
    const pasted = healthPayload(report);
    expect(pasted.rateLimit).toEqual(report.rateLimit);
    expect(JSON.stringify(pasted)).not.toContain("cached-token-429");
    expect(JSON.stringify(pasted)).not.toContain(PASSWORD);
  });

  it("shares one in-flight login and the throttle snapshot with a later session", async () => {
    resetProcessMemory();
    let logins = 0;
    let gets = 0;
    let releaseLogin: () => void = () => undefined;
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve;
    });
    const impl: (url: string, init?: RequestInit) => Promise<Response> = async (url, init) => {
      if ((init?.method ?? "GET") === "POST") {
        logins += 1;
        expect(new URL(url).pathname).toBe("/api/auth/login");
        await loginGate;
        return json({ token: "shared-token", expiry: Math.floor(Date.now() / 1000) + 3600 });
      }
      gets += 1;
      if (gets === 1) {
        return new Response(JSON.stringify({ message: "Too Many Attempts" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "0",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1700003600",
          },
        });
      }
      return json({ results: { data: [{ id: 1 }] } }, 200, {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "59",
      });
    };
    const shared = config({ mode: "login", apiKey: "", username: "shared-throttle", loginPath: "/api/auth/login" });
    const first = new ApiSession(shared, impl);
    const second = new ApiSession(shared, impl);
    const both = Promise.all([first.probe(), second.probe()]);
    await Promise.resolve();
    releaseLogin();
    const [left, right] = await both;
    expect(logins).toBe(1);
    expect(left.status).toBe("connected");
    expect(right.status).toBe("connected");
    expect(left.rateLimit).toEqual({
      retryAfter: "0",
      limit: "60",
      remaining: "0",
      reset: "1700003600",
      status: 429,
    });

    let laterLogins = 0;
    const later = new ApiSession(shared, async (_url, init) => {
      if ((init?.method ?? "GET") === "POST") {
        laterLogins += 1;
        return json({ token: "should-not-login" });
      }
      return json({ results: { data: [{ id: 1 }] } }, 200, { "x-ratelimit-remaining": "58" });
    });
    const report = await later.probe();
    expect(laterLogins).toBe(0);
    expect(report.rateLimit?.status).toBe(429);
    expect(report.rateLimit?.remaining).toBe("0");
    expect(report.loginPath).toBe("/api/auth/login");
    expect(JSON.stringify(report)).not.toContain("shared-token");
    expect(JSON.stringify(report)).not.toContain("should-not-login");
  });

  it("rejects header injection in credentials", () => {
    expect(() => basicAuthorization("ada\r\nX-Injected: 1", PASSWORD)).toThrow(/not valid/);
  });

  it("drops userinfo from the base URL and refuses an off-host login path", async () => {
    expect(
      readApiAuthConfig({
        SUBHUB_API_BASE_URL: "https://cxm-service:super-secret-password@app.subcontractorhub.com",
      }).baseUrl,
    ).toBe("https://app.subcontractorhub.com");

    let called = false;
    const session = new ApiSession(config({ mode: "login", loginPath: "https://evil.example/login" }), async () => {
      called = true;
      return json({});
    });
    await expect(session.request("/api/v1/superadmin/orgs")).rejects.toThrow(/API host/);
    expect(called).toBe(false);
  });
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}
