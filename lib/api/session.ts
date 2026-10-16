/**
 * Server-side SubcontractorHub auth. This module must not be imported by
 * client components. It never puts credentials in errors, URLs, or return
 * values that are safe to send to a browser.
 */

import { inspectResponse, redactSecrets } from "./body";

export { redactSecrets };

export const DEFAULT_BASE_URL = "https://app.subcontractorhub.com";
export const DEFAULT_KEY_HEADER = "X-API-Key";
export const DEFAULT_LOGIN_PATH = "/api/login";

export type AuthModeName = "bearer" | "basic" | "basic+key" | "login";
export type AuthModeSetting = "auto" | AuthModeName;

export type ApiAuthConfig = {
  baseUrl: string;
  apiKey: string;
  username: string;
  password: string;
  mode: AuthModeSetting;
  keyHeader: string;
  /** Blank disables the Sanctum fallback unless mode is explicitly `login`. */
  loginPath: string;
  loginUsernameField: string;
  loginPasswordField: string;
  loginKeyField: string;
  loginDeviceName: string;
};

export type ConnectionReport = {
  status: "demo" | "connected" | "auth failed" | "unexpected body";
  mode?: AuthModeName;
  httpStatus: number;
  upstreamStatus?: number;
  contentType?: string;
  bodyKind?: "html" | "json" | "text" | "empty";
  topLevelKeys?: string[];
  recordCount?: number | null;
  detail?: string;
};

export class AuthRejectedError extends Error {
  constructor() {
    super("SubcontractorHub API rejected the configured credentials.");
    this.name = "AuthRejectedError";
  }
}

type EnvSource = Record<string, string | undefined>;

const HEADER_NAME = /^[A-Za-z0-9-]+$/;

export function readApiAuthConfig(env: EnvSource): ApiAuthConfig {
  const mode = parseMode(env.SUBHUB_AUTH_MODE);
  const keyHeader = env.SUBHUB_API_KEY_HEADER?.trim() || DEFAULT_KEY_HEADER;
  if (!HEADER_NAME.test(keyHeader)) {
    throw new Error("SUBHUB_API_KEY_HEADER is not a valid header name.");
  }
  return {
    baseUrl: normalizeBase(env.SUBHUB_API_BASE_URL?.trim() || DEFAULT_BASE_URL),
    apiKey: env.SUBHUB_API_KEY?.trim() ?? "",
    username: env.SUBHUB_API_USERNAME?.trim() ?? "",
    password: env.SUBHUB_API_PASSWORD ?? "",
    mode,
    keyHeader,
    loginPath: env.SUBHUB_LOGIN_PATH?.trim() ?? "",
    loginUsernameField: env.SUBHUB_LOGIN_USERNAME_FIELD?.trim() || "email",
    loginPasswordField: env.SUBHUB_LOGIN_PASSWORD_FIELD?.trim() || "password",
    loginKeyField: env.SUBHUB_LOGIN_KEY_FIELD?.trim() ?? "key",
    loginDeviceName: env.SUBHUB_LOGIN_DEVICE_NAME?.trim() || "cxm-dashboard",
  };
}

function parseMode(value: string | undefined): AuthModeSetting {
  const mode = value?.trim().toLowerCase() || "auto";
  if (mode === "auto" || mode === "bearer" || mode === "basic" || mode === "basic+key" || mode === "login") {
    return mode;
  }
  throw new Error("SUBHUB_AUTH_MODE must be auto, bearer, basic, basic+key, or login.");
}

export function credentialsReady(config: ApiAuthConfig, mode: AuthModeName): boolean {
  if (mode === "bearer") return config.apiKey.length > 0;
  if (mode === "basic" || mode === "login") return config.username.length > 0 && config.password.length > 0;
  return config.username.length > 0 && config.password.length > 0 && config.apiKey.length > 0;
}

/**
 * Auto order: basic+key, then basic, then bearer.
 * Login is not selected here; it is only an optional 401 fallback.
 */
export function primaryMode(config: ApiAuthConfig): AuthModeName | null {
  if (config.mode === "auto") {
    if (credentialsReady(config, "basic+key")) return "basic+key";
    if (credentialsReady(config, "basic")) return "basic";
    if (credentialsReady(config, "bearer")) return "bearer";
    return null;
  }
  return credentialsReady(config, config.mode) ? config.mode : null;
}

export function connectionIntent(config: ApiAuthConfig): "demo" | "ready" | "incomplete" {
  if (primaryMode(config)) return "ready";
  if (config.mode !== "auto") return "incomplete";
  return "demo";
}

function loginFallbackEnabled(config: ApiAuthConfig): boolean {
  if (!config.username || !config.password) return false;
  if (config.mode === "login") return true;
  return config.mode === "auto" && config.loginPath.length > 0;
}

function normalizeBase(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad protocol");
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("SUBHUB_API_BASE_URL is not a valid URL.");
  }
}

function loginUrl(config: ApiAuthConfig): string {
  const path = config.mode === "login" && !config.loginPath ? DEFAULT_LOGIN_PATH : config.loginPath;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /\s/.test(path)) {
    throw new Error("SUBHUB_LOGIN_PATH must be a path on the API host.");
  }
  const url = new URL(path, `${config.baseUrl}/`);
  if (url.origin !== new URL(config.baseUrl).origin) {
    throw new Error("SUBHUB_LOGIN_PATH must be a path on the API host.");
  }
  return url.toString();
}

function assertHeaderValue(value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error("SubcontractorHub API credentials are not valid.");
  }
}

export function basicAuthorization(username: string, password: string): string {
  assertHeaderValue(username);
  assertHeaderValue(password);
  if (username.includes(":")) {
    throw new Error("SubcontractorHub API credentials are not valid.");
  }
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiSession {
  private token: string | null = null;
  private inflight: Promise<string> | null = null;
  private inflightGeneration = 0;
  private generation = 0;

  constructor(
    private readonly config: ApiAuthConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async request(path: string, search?: Record<string, string | number | undefined>): Promise<{ response: Response; mode: AuthModeName }> {
    const mode = primaryMode(this.config);
    if (!mode) throw new Error("SubcontractorHub API credentials are not set.");
    return this.requestWithMode(mode, path, search, true);
  }

  async probe(): Promise<ConnectionReport> {
    const intent = connectionIntent(this.config);
    if (intent === "demo") return { status: "demo", httpStatus: 200 };
    if (intent === "incomplete") return { status: "auth failed", httpStatus: 401 };
    try {
      const { response, mode } = await this.request("/api/v1/superadmin/orgs", { limit: 1 });
      const text = await response.text();
      const { summary } = inspectResponse(response.headers.get("content-type"), text, [this.config.apiKey, this.config.password]);
      const diagnostic = {
        mode,
        upstreamStatus: response.status,
        contentType: summary.contentType,
        bodyKind: summary.bodyKind,
        topLevelKeys: summary.topLevelKeys,
        recordCount: summary.recordCount,
        detail: summary.detail,
      };
      if (response.status === 401 || response.status === 403) return { status: "auth failed", httpStatus: 401, ...diagnostic };
      if (!response.ok) return { status: "auth failed", httpStatus: 503, ...diagnostic };
      if (summary.bodyKind === "json" && summary.recordCount !== null) return { status: "connected", httpStatus: 200, ...diagnostic };
      return { status: "unexpected body", httpStatus: 200, ...diagnostic };
    } catch (error) {
      if (error instanceof AuthRejectedError) return { status: "auth failed", httpStatus: 401 };
      if (error instanceof Error && /credentials are not valid|AUTH_MODE|KEY_HEADER/.test(error.message)) throw error;
      return { status: "auth failed", httpStatus: 503 };
    }
  }

  private async requestWithMode(
    mode: AuthModeName,
    path: string,
    search: Record<string, string | number | undefined> | undefined,
    allowLoginFallback: boolean,
  ): Promise<{ response: Response; mode: AuthModeName }> {
    const token = mode === "login" ? await this.getToken(false) : undefined;
    let response = await this.fetchAuthed(mode, path, search, token);
    if (response.status !== 401) return { response, mode };

    if (mode === "login") {
      await discard(response);
      const refreshed = await this.getToken(true);
      response = await this.fetchAuthed("login", path, search, refreshed);
      return { response, mode: "login" };
    }

    if (allowLoginFallback && loginFallbackEnabled(this.config)) {
      await discard(response);
      return this.requestWithMode("login", path, search, false);
    }
    return { response, mode };
  }

  private async fetchAuthed(
    mode: AuthModeName,
    path: string,
    search: Record<string, string | number | undefined> | undefined,
    token: string | undefined,
  ): Promise<Response> {
    const url = new URL(path, `${this.config.baseUrl}/`);
    for (const [key, value] of Object.entries(search ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const headers = new Headers({ Accept: "application/json" });
    this.applyAuth(headers, mode, token);
    try {
      return await this.fetchImpl(url.toString(), { headers, cache: "no-store", redirect: "manual" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SubcontractorHub request failed.";
      throw new Error(redactSecrets(message, [this.config.apiKey, this.config.password, token]));
    }
  }

  private applyAuth(headers: Headers, mode: AuthModeName, token: string | undefined): void {
    if (mode === "bearer") {
      assertHeaderValue(this.config.apiKey);
      headers.set("Authorization", `Bearer ${this.config.apiKey}`);
      return;
    }
    if (mode === "basic" || mode === "basic+key") {
      headers.set("Authorization", basicAuthorization(this.config.username, this.config.password));
      if (mode === "basic+key") {
        assertHeaderValue(this.config.apiKey);
        headers.set(this.config.keyHeader, this.config.apiKey);
      }
      return;
    }
    if (!token) throw new Error("SubcontractorHub login did not return a token.");
    assertHeaderValue(token);
    headers.set("Authorization", `Bearer ${token}`);
  }

  private async getToken(force: boolean): Promise<string> {
    if (!force && this.token) return this.token;
    const generation = force ? ++this.generation : this.generation;
    if (this.inflight && this.inflightGeneration === generation) return this.inflight;
    this.inflightGeneration = generation;
    const pending = this.login().then((token) => {
      if (this.generation === generation) this.token = token;
      return token;
    });
    this.inflight = pending;
    try {
      return await pending;
    } finally {
      if (this.inflight === pending) this.inflight = null;
    }
  }

  private async login(): Promise<string> {
    const body: Record<string, string> = {
      [this.config.loginUsernameField]: this.config.username,
      [this.config.loginPasswordField]: this.config.password,
    };
    if (this.config.loginDeviceName) body.device_name = this.config.loginDeviceName;
    if (this.config.loginKeyField && this.config.apiKey) body[this.config.loginKeyField] = this.config.apiKey;
    let response: Response;
    try {
      response = await this.fetchImpl(loginUrl(this.config), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "manual",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SubcontractorHub login failed.";
      throw new Error(redactSecrets(message, [this.config.apiKey, this.config.password]));
    }
    if (response.status === 401 || response.status === 403) {
      await discard(response);
      throw new AuthRejectedError();
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`SubcontractorHub login failed (${response.status}).`);
    const token = extractToken(text);
    if (!token) throw new AuthRejectedError();
    return token;
  }
}

function extractToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) return null;
  try {
    return tokenFromPayload(JSON.parse(trimmed));
  } catch {
    return trimmed.includes(" ") ? null : trimmed;
  }
}

function tokenFromPayload(payload: unknown, depth = 0): string | null {
  if (typeof payload === "string" && payload.trim() && !payload.includes(" ")) return payload.trim();
  if (!payload || typeof payload !== "object" || depth > 2) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["token", "access_token", "plainTextToken", "plain_text_token"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return tokenFromPayload(record.data, depth + 1);
}

async function discard(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined);
}
