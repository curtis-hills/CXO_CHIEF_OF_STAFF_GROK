import { describe, expect, it } from "vitest";
import {
  ApiSession,
  basicAuthorization,
  readApiAuthConfig,
  redactSecrets,
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
    loginKeyField: "key",
    loginDeviceName: "cxm-dashboard",
    ...overrides,
  };
}

function headersOf(init?: RequestInit): Headers {
  return new Headers(init?.headers);
}

describe("API auth", () => {
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
    expect(report).toMatchObject({ status: "connected", mode: "bearer", httpStatus: 200, bodyKind: "json", recordCount: 0 });
    expect(headersOf(calls[0]?.init).get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(calls[0]?.url).toContain("https://app.subcontractorhub.com/api/v1/superadmin/orgs");
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

  it("auto-selects basic+key when username, password, and key are all set", async () => {
    const methods: string[] = [];
    const session = new ApiSession(config(), async (url, init) => {
      methods.push(`${init?.method ?? "GET"} ${url}`);
      return json({ results: { data: [] } });
    });
    const report = await session.probe();
    expect(report.mode).toBe("basic+key");
    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatch(/^GET /);
  });

  it("auto-selects basic when no key is set, and bearer when only the key is set", async () => {
    const basic = new ApiSession(config({ apiKey: "" }), async () => json({ ok: true }));
    const bearer = new ApiSession(config({ username: "", password: "" }), async () => json({ ok: true }));
    expect((await basic.probe()).mode).toBe("basic");
    expect((await bearer.probe()).mode).toBe("bearer");
  });

  it("does not fall back to Sanctum login unless a login path is configured", async () => {
    let posts = 0;
    const session = new ApiSession(config(), async (_url, init) => {
      if ((init?.method ?? "GET") === "POST") posts += 1;
      return new Response("no", { status: 401 });
    });
    const report = await session.probe();
    expect(report).toMatchObject({ status: "auth failed", httpStatus: 401, mode: "basic+key" });
    expect(posts).toBe(0);
  });

  it("falls back to Sanctum login after a 401 when the login path is set", async () => {
    const calls: string[] = [];
    const session = new ApiSession(config({ loginPath: "/api/login" }), async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(String(init?.body));
        expect(body.email).toBe("cxm-service");
        expect(body.password).toBe(PASSWORD);
        expect(body.key).toBe(API_KEY);
        expect(body.device_name).toBe("cxm-dashboard");
        return json({ token: "cached-token-1" });
      }
      const authorization = headersOf(init).get("authorization") ?? "";
      if (authorization.startsWith("Basic ")) return new Response("no", { status: 401 });
      expect(authorization).toBe("Bearer cached-token-1");
      return json({ results: { data: [] } });
    });
    const report = await session.probe();
    expect(report).toMatchObject({ status: "connected", mode: "login", httpStatus: 200 });
    expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
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
      if (url.endsWith("/api/login")) {
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
      if (url.endsWith("/api/login")) {
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
      if (url.endsWith("/api/login")) {
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
