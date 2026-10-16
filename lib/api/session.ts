/**
 * Server-side SubcontractorHub auth. This module must not be imported by
 * client components. It never puts credentials in errors, URLs, or return
 * values that are safe to send to a browser.
 */

import { inspectResponse, redactSecrets } from "./body";
import { PAGE_SIZE, REQUEST_TIMEOUT_MS } from "./limits";
import { MAX_RATE_LIMIT_RETRIES, readRateLimitHeaders, retryDelayMs, type RateLimitSnapshot } from "./rate-limit";

export { redactSecrets };

export const DEFAULT_BASE_URL = "https://app.subcontractorhub.com";
export const DEFAULT_KEY_HEADER = "X-API-Key";
export const DEFAULT_LOGIN_PATH = "/api/auth/login";
export const DEFAULT_LOGIN_PATHS = ["/api/auth/login", "/api/login", "/api/v1/login"] as const;
const TOKEN_SKEW_MS = 60_000;
const TOKEN_SKEW_MIN_LIFE_MS = 120_000;
const TOKEN_FALLBACK_MS = 60 * 60 * 1000;
const TOKEN_PERSISTENT_MS = 12 * 60 * 60 * 1000;

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

export type LoginAttemptReport = {
  path: string;
  upstreamStatus: number;
  contentType: string;
  bodyKind: "html" | "json" | "text" | "empty";
  topLevelKeys: string[];
};

export type RateLimitReport = {
  retryAfter?: string;
  limit?: string;
  remaining?: string;
  reset?: string;
  status: number;
};

export type ConnectionReport = {
  status: "demo" | "connected" | "auth failed" | "unexpected body" | "rate limited";
  mode?: AuthModeName;
  httpStatus: number;
  upstreamStatus?: number;
  contentType?: string;
  bodyKind?: "html" | "json" | "text" | "empty";
  topLevelKeys?: string[];
  recordCount?: number | null;
  /** Whether the orgs page included a non-empty next_cursor. The cursor itself is omitted. */
  hasNextCursor?: boolean;
  /** Latest Retry-After / X-RateLimit-* values. Never includes a token. */
  rateLimit?: RateLimitReport;
  detail?: string;
  /** Login path that returned a token. */
  loginPath?: string;
  /** Each Sanctum login path that was tried. Never includes the token or password. */
  loginAttempts?: LoginAttemptReport[];
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
    loginKeyField: env.SUBHUB_LOGIN_KEY_FIELD?.trim() ?? "",
    loginDeviceName: env.SUBHUB_LOGIN_DEVICE_NAME?.trim() ?? "",
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
 * Auto order: Sanctum login when a username and password are set, otherwise bearer.
 * HTTP Basic is not selected. The API answers Basic with the HTML login page.
 * Set SUBHUB_AUTH_MODE to basic or basic+key to send Basic anyway.
 */
export function primaryMode(config: ApiAuthConfig): AuthModeName | null {
  if (config.mode === "auto") {
    if (credentialsReady(config, "login")) return "login";
    if (credentialsReady(config, "bearer")) return "bearer";
    return null;
  }
  return credentialsReady(config, config.mode) ? config.mode : null;
}

/** Configured path first, then the common Sanctum paths that are not already listed. */
export function loginPaths(config: ApiAuthConfig): string[] {
  const paths: string[] = [];
  if (config.loginPath) paths.push(config.loginPath);
  for (const path of DEFAULT_LOGIN_PATHS) {
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function connectionIntent(config: ApiAuthConfig): "demo" | "ready" | "incomplete" {
  if (primaryMode(config)) return "ready";
  if (config.mode !== "auto") return "incomplete";
  return "demo";
}

function loginFallbackEnabled(config: ApiAuthConfig): boolean {
  if (!config.username || !config.password) return false;
  return config.mode === "basic" || config.mode === "basic+key";
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

function loginUrl(config: ApiAuthConfig, path: string): string {
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

type ProcessLogin = { key: string; promise: Promise<string> };

type ProcessLoginMeta = { key: string; path: string; attempts: LoginAttemptReport[] };

type ProcessMemory = {
  token: { key: string; value: string; expiresAt: number } | null;
  login: ProcessLogin | null;
  loginMeta: ProcessLoginMeta | null;
  throttle: RateLimitSnapshot | null;
  rateLimit: RateLimitSnapshot | null;
};

const EMPTY_PROCESS_MEMORY = (): ProcessMemory => ({
  token: null,
  login: null,
  loginMeta: null,
  throttle: null,
  rateLimit: null,
});

/**
 * Next can compile the page and /api/health into separate module copies, so a
 * module-level session is not enough. The object lives on both globalThis and
 * process; whichever realm the other bundle can see, it finds the same record.
 */
function sharedProcessMemory(): ProcessMemory {
  const holder = globalThis as typeof globalThis & { __cxmApiMemory?: ProcessMemory };
  const proc = process as typeof process & { __cxmApiMemory?: ProcessMemory };
  const existing = holder.__cxmApiMemory ?? proc.__cxmApiMemory;
  if (existing) {
    holder.__cxmApiMemory = existing;
    proc.__cxmApiMemory = existing;
    return existing;
  }
  const created = EMPTY_PROCESS_MEMORY();
  holder.__cxmApiMemory = created;
  proc.__cxmApiMemory = created;
  return created;
}

const processMemory: ProcessMemory = sharedProcessMemory();

/** Drops the shared token, in-flight login, and throttle snapshot. */
export function resetProcessMemory(): void {
  const fresh = EMPTY_PROCESS_MEMORY();
  processMemory.token = fresh.token;
  processMemory.login = fresh.login;
  processMemory.loginMeta = fresh.loginMeta;
  processMemory.throttle = fresh.throttle;
  processMemory.rateLimit = fresh.rateLimit;
}

function sessionKey(config: ApiAuthConfig): string {
  return [config.baseUrl, config.mode, config.username, config.apiKey].join("\u0000");
}

export class ApiSession {
  private token: string | null = null;
  private tokenExpiresAt: number | null = null;
  private inflight: Promise<string> | null = null;
  private inflightGeneration = 0;
  private generation = 0;
  private loginPathUsed: string | null = null;
  private loginAttempts: LoginAttemptReport[] = [];
  private lastRateLimit: RateLimitSnapshot | null = null;
  /** Kept even when a later 200 also sends X-RateLimit-* headers. */
  private lastThrottle: RateLimitSnapshot | null = null;

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
      const { response, mode } = await this.request("/api/v1/superadmin/orgs", { limit: PAGE_SIZE });
      const text = await response.text();
      const { summary } = inspectResponse(response.headers.get("content-type"), text, [this.config.apiKey, this.config.password]);
      const diagnostic = {
        mode,
        upstreamStatus: response.status,
        contentType: summary.contentType,
        bodyKind: summary.bodyKind,
        topLevelKeys: summary.topLevelKeys,
        recordCount: summary.recordCount,
        hasNextCursor: summary.hasNextCursor,
        detail: summary.detail,
        ...this.loginMeta(),
        ...this.rateLimitMeta(),
      };
      if (response.status === 429) return { status: "rate limited", httpStatus: 503, ...diagnostic };
      if (response.status === 401 || response.status === 403) return { status: "auth failed", httpStatus: 401, ...diagnostic };
      if (!response.ok) return { status: "auth failed", httpStatus: 503, ...diagnostic };
      if (summary.bodyKind === "json" && summary.recordCount !== null) return { status: "connected", httpStatus: 200, ...diagnostic };
      return { status: "unexpected body", httpStatus: 200, ...diagnostic };
    } catch (error) {
      const meta = { mode: primaryMode(this.config) ?? undefined, ...this.loginMeta() };
      if (error instanceof AuthRejectedError) return { status: "auth failed", httpStatus: 401, ...meta };
      if (error instanceof Error && /credentials are not valid|AUTH_MODE|KEY_HEADER|API host/.test(error.message)) throw error;
      return { status: "auth failed", httpStatus: 503, ...meta };
    }
  }

  private rateLimitMeta(): { rateLimit?: RateLimitReport } {
    const snap = processMemory.throttle ?? this.lastThrottle ?? processMemory.rateLimit ?? this.lastRateLimit;
    if (!snap) return {};
    const rateLimit: RateLimitReport = { status: snap.status };
    if (snap.retryAfter) rateLimit.retryAfter = snap.retryAfter;
    if (snap.limit) rateLimit.limit = snap.limit;
    if (snap.remaining) rateLimit.remaining = snap.remaining;
    if (snap.reset) rateLimit.reset = snap.reset;
    return { rateLimit };
  }

  private loginMeta(): { loginPath?: string; loginAttempts?: LoginAttemptReport[] } {
    const shared =
      this.loginAttempts.length === 0 && processMemory.loginMeta?.key === sessionKey(this.config)
        ? processMemory.loginMeta
        : null;
    const attempts = this.loginAttempts.length > 0 ? this.loginAttempts : (shared?.attempts ?? []);
    const path = this.loginAttempts.length > 0 ? this.loginPathUsed : (shared?.path ?? null);
    if (attempts.length === 0) return {};
    return {
      ...(path ? { loginPath: path } : {}),
      loginAttempts: attempts,
    };
  }

  private async requestWithMode(
    mode: AuthModeName,
    path: string,
    search: Record<string, string | number | undefined> | undefined,
    allowLoginFallback: boolean,
  ): Promise<{ response: Response; mode: AuthModeName }> {
    const token = mode === "login" ? await this.getToken(false) : undefined;
    let response = await this.fetchAuthed(mode, path, search, token);
    // 429 is throttling. Retry-After is handled in fetchAuthed. Do not log in again.
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
    const secrets = [this.config.apiKey, this.config.password, token].filter((value): value is string => Boolean(value));
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          headers,
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "SubcontractorHub request failed.";
        throw new Error(redactSecrets(message, secrets));
      }
      const observed = readRateLimitHeaders(response.headers, response.status, secrets);
      if (observed) {
        this.lastRateLimit = observed;
        processMemory.rateLimit = observed;
        if (response.status === 429) {
          this.lastThrottle = observed;
          processMemory.throttle = observed;
        }
      }
      if (response.status !== 429 || attempt === MAX_RATE_LIMIT_RETRIES) return response;
      const delay = retryDelayMs(response.headers, attempt + 1);
      await discard(response);
      await sleep(delay);
    }
    throw new Error("SubcontractorHub request failed.");
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

  private tokenExpired(): boolean {
    return this.tokenExpiresAt !== null && Date.now() >= this.tokenExpiresAt;
  }

  private rememberToken(token: string, expiresAt: number): void {
    this.token = token;
    this.tokenExpiresAt = expiresAt;
    processMemory.token = { key: sessionKey(this.config), value: token, expiresAt };
  }

  private adoptProcessToken(): void {
    const saved = processMemory.token;
    if (!saved || saved.key !== sessionKey(this.config)) return;
    if (Date.now() >= saved.expiresAt) return;
    this.token = saved.value;
    this.tokenExpiresAt = saved.expiresAt;
  }

  private async getToken(force: boolean): Promise<string> {
    const key = sessionKey(this.config);
    if (!force) this.adoptProcessToken();
    if (!force && this.token && !this.tokenExpired()) return this.token;
    const refresh = force || (this.token !== null && this.tokenExpired());
    if (refresh) {
      this.token = null;
      this.tokenExpiresAt = null;
      if (processMemory.token?.key === key) processMemory.token = null;
    }
    const shared = !force ? processMemory.login : null;
    if (shared?.key === key) {
      const token = await shared.promise;
      this.adoptProcessToken();
      return this.token && !this.tokenExpired() ? this.token : token;
    }
    const generation = refresh ? ++this.generation : this.generation;
    if (this.inflight && this.inflightGeneration === generation) return this.inflight;

    // Publish the in-flight login before the first await. Otherwise a second
    // session can start its own POST while this one is already inside fetch.
    let resolveLogin: (token: string) => void = () => undefined;
    let rejectLogin: (error: unknown) => void = () => undefined;
    const gate = new Promise<string>((resolve, reject) => {
      resolveLogin = resolve;
      rejectLogin = reject;
    });
    gate.catch(() => undefined);
    this.inflightGeneration = generation;
    this.inflight = gate;
    processMemory.login = { key, promise: gate };
    try {
      const issued = await this.login();
      if (this.generation === generation) {
        this.rememberToken(issued.token, issued.expiresAt);
        processMemory.loginMeta = { key, path: this.loginPathUsed ?? "", attempts: this.loginAttempts };
      }
      resolveLogin(issued.token);
      return issued.token;
    } catch (error) {
      rejectLogin(error);
      throw error;
    } finally {
      if (processMemory.login?.promise === gate) processMemory.login = null;
      if (this.inflight === gate) this.inflight = null;
    }
  }

  private loginBody(): Record<string, string> {
    const body: Record<string, string> = {
      [this.config.loginUsernameField]: this.config.username,
      [this.config.loginPasswordField]: this.config.password,
    };
    if (this.config.loginDeviceName) body.device_name = this.config.loginDeviceName;
    if (this.config.loginKeyField && this.config.apiKey) body[this.config.loginKeyField] = this.config.apiKey;
    return body;
  }

  private async login(): Promise<{ token: string; expiresAt: number }> {
    this.loginAttempts = [];
    this.loginPathUsed = null;
    let rejected = false;
    for (const path of loginPaths(this.config)) {
      const result = await this.postLogin(path);
      this.loginAttempts.push(result.attempt);
      if (result.token) {
        this.loginPathUsed = path;
        return { token: result.token, expiresAt: result.expiresAt };
      }
      if (result.rejected) {
        rejected = true;
        break;
      }
    }
    if (rejected) throw new AuthRejectedError();
    throw new AuthRejectedError();
  }

  private async postLogin(path: string): Promise<{ token: string | null; expiresAt: number; rejected: boolean; attempt: LoginAttemptReport }> {
    let response: Response;
    try {
      response = await this.fetchImpl(loginUrl(this.config, path), {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(this.loginBody()),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "SubcontractorHub login failed.";
      throw new Error(redactSecrets(message, [this.config.apiKey, this.config.password]));
    }
    const text = await response.text();
    const { summary } = inspectResponse(response.headers.get("content-type"), text, [this.config.password, this.config.apiKey]);
    const attempt: LoginAttemptReport = {
      path,
      upstreamStatus: response.status,
      contentType: summary.contentType,
      bodyKind: summary.bodyKind,
      topLevelKeys: summary.topLevelKeys,
    };
    const missed = { token: null, expiresAt: 0, rejected: false, attempt };
    if (response.status === 401 || response.status === 403) return { ...missed, rejected: true };
    if (!response.ok) return missed;
    const token = extractToken(text);
    return { token, expiresAt: resolveTokenExpiry(parseJson(text), Date.now()), rejected: false, attempt };
  }
}

/**
 * Absolute time, in ms, when a login token should be treated as expired.
 * `expiry` may be a ms timestamp, unix seconds, seconds from now, or a date string.
 * A lifetime longer than two minutes is shortened by 60 seconds. `persistent` without
 * an expiry lasts 12 hours. Anything else lasts one hour, and a 401 still forces a refresh.
 */
export function resolveTokenExpiry(payload: unknown, now = Date.now()): number {
  const record = isRecord(payload) ? payload : {};
  const persistent = record.persistent === true;
  const absolute = absoluteExpiry(record.expiry ?? record.expires_at ?? record.expiresAt, now);
  if (absolute !== null) {
    const life = absolute - now;
    if (life > TOKEN_SKEW_MIN_LIFE_MS) return absolute - TOKEN_SKEW_MS;
    return absolute;
  }
  if (persistent) return now + TOKEN_PERSISTENT_MS;
  return now + TOKEN_FALLBACK_MS;
}

function absoluteExpiry(value: unknown, now: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return expiryFromNumber(value, now);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return expiryFromNumber(Number(trimmed), now);
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function expiryFromNumber(value: number, now: number): number | null {
  if (!(value > 0)) return null;
  if (value >= 1e12) return value;
  if (value >= 1e9) return value * 1000;
  return now + value * 1000;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim()) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
