export type BodyKind = "html" | "json" | "text" | "empty";

export type ResponseSummary = {
  contentType: string;
  bodyKind: BodyKind;
  topLevelKeys: string[];
  recordCount: number | null;
  detail: string;
};

export type PageQuery = {
  cursor?: string;
  page?: number;
};

export class SubhubApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly contentType: string;
  readonly bodyKind: BodyKind;
  readonly topLevelKeys: string[];
  readonly recordCount: number | null;
  readonly detail: string;

  constructor(status: number, path: string, summary: ResponseSummary) {
    super(formatApiError(path, status, summary));
    this.name = "SubhubApiError";
    this.status = status;
    this.path = path;
    this.contentType = summary.contentType;
    this.bodyKind = summary.bodyKind;
    this.topLevelKeys = summary.topLevelKeys;
    this.recordCount = summary.recordCount;
    this.detail = summary.detail;
  }
}

export class UnrecognizedCollectionError extends Error {
  readonly payload: unknown;

  constructor(payload: unknown) {
    super("Unrecognized API collection");
    this.name = "UnrecognizedCollectionError";
    this.payload = payload;
  }
}

export function emptySummary(detail = ""): ResponseSummary {
  return { contentType: "", bodyKind: "empty", topLevelKeys: [], recordCount: null, detail };
}

export function formatApiError(path: string, status: number, summary: ResponseSummary): string {
  const type = summary.contentType || "no content-type";
  const extra = summary.detail ? `, ${summary.detail}` : "";
  return `SubcontractorHub API ${path} returned ${status} (${type}, ${summary.bodyKind}${extra})`;
}

export function connectionNotice(error: unknown, secrets: string[] = []): string {
  if (error instanceof SubhubApiError) return error.message;
  if (error instanceof Error) {
    const clean = sanitizeSnippet(error.message, secrets);
    return clean ? `The live API could not be read. ${clean}` : "The live API could not be read.";
  }
  return "The live API could not be read.";
}

export function inspectResponse(
  contentType: string | null,
  raw: string,
  secrets: string[] = [],
): { summary: ResponseSummary; payload: unknown | null } {
  const mime = safeContentType(contentType);
  const parsed = tryParseJson(raw);
  if (!raw.trim()) {
    return { summary: { contentType: mime, bodyKind: "empty", topLevelKeys: [], recordCount: null, detail: "" }, payload: null };
  }
  if (parsed.ok) {
    const payload = parsed.value;
    const collection = collectionFromPayload(payload);
    const topLevelKeys = safeKeys(payload);
    const summary: ResponseSummary = {
      contentType: mime || "application/json",
      bodyKind: "json",
      topLevelKeys,
      recordCount: collection ? collection.items.length : null,
      detail: jsonDetail(payload, topLevelKeys, Boolean(collection), secrets),
    };
    return { summary, payload };
  }
  if (looksLikeHtml(raw, mime)) {
    return {
      summary: {
        contentType: mime || "text/html",
        bodyKind: "html",
        topLevelKeys: [],
        recordCount: null,
        detail: htmlDetail(raw, secrets),
      },
      payload: null,
    };
  }
  return {
    summary: {
      contentType: mime,
      bodyKind: "text",
      topLevelKeys: [],
      recordCount: null,
      detail: sanitizeSnippet(raw, secrets),
    },
    payload: null,
  };
}

export function collectionFromPayload<T>(payload: unknown): { items: T[]; next: PageQuery | null } | null {
  if (Array.isArray(payload)) return { items: payload as T[], next: null };
  if (!isRecord(payload)) return null;
  for (const key of ["data", "results", "orgs", "projects", "items"]) {
    const value = payload[key];
    if (Array.isArray(value)) return { items: value as T[], next: nextQuery(payload) };
    if (isRecord(value) && Array.isArray(value.data)) {
      return { items: value.data as T[], next: nextQuery(value) ?? nextQuery(payload) };
    }
  }
  return null;
}

export async function collectAll<T>(load: (query: PageQuery) => Promise<unknown>): Promise<T[]> {
  const items: T[] = [];
  let query: PageQuery = {};
  const seen = new Set<string>();
  for (let page = 0; page < 40; page += 1) {
    const key = `${query.page ?? ""}:${query.cursor ?? ""}`;
    if (seen.has(key)) break;
    seen.add(key);
    const payload = await load(query);
    const collection = collectionFromPayload<T>(payload);
    if (!collection) throw new UnrecognizedCollectionError(payload);
    items.push(...collection.items);
    if (!collection.next) break;
    query = collection.next;
  }
  return items;
}

export function redactSecrets(message: string, secrets: Array<string | undefined>): string {
  let out = message;
  const unique = [...new Set(secrets.filter((secret): secret is string => Boolean(secret && secret.length >= 3)))];
  unique.sort((a, b) => b.length - a.length);
  for (const secret of unique) out = out.split(secret).join("[redacted]");
  return out;
}

export function sanitizeSnippet(value: string, secrets: string[] = []): string {
  const collapsed = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const redacted = redactSecrets(stripSensitive(collapsed), secrets);
  if (redacted.length <= 200) return redacted;
  return `${redacted.slice(0, 199)}…`;
}

function jsonDetail(payload: unknown, keys: string[], recognized: boolean, secrets: string[]): string {
  if (Array.isArray(payload)) return "top-level array";
  const parts = [`keys: ${keys.join(", ") || "(none)"}`];
  if (!recognized && isRecord(payload)) {
    const message = payload.message ?? payload.error;
    if (typeof message === "string" && message.trim()) parts.push(`message: ${sanitizeSnippet(message, secrets)}`);
  }
  return clip(parts.join("; "));
}

function htmlDetail(raw: string, secrets: string[]): string {
  const title = htmlTitle(raw);
  const markers = htmlMarkers(raw);
  const parts: string[] = [];
  if (title) parts.push(`title "${sanitizeSnippet(title, secrets)}"`);
  if (markers.length > 0) parts.push(`markers: ${markers.join(", ")}`);
  return clip(parts.join("; ") || "HTML document");
}

function htmlTitle(raw: string): string {
  const match = raw.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!match?.[1]) return "";
  return decodeEntities(match[1].replace(/<[^>]+>/g, " "));
}

function htmlMarkers(raw: string): string[] {
  const sample = raw.slice(0, 20_000);
  const markers: string[] = [];
  if (/<!doctype\s+html/i.test(sample)) markers.push("doctype");
  if (/<html\b/i.test(sample)) markers.push("html");
  if (/<form\b/i.test(sample)) markers.push("form");
  if (/type\s*=\s*["']password["']/i.test(sample)) markers.push("password-field");
  if (/csrf/i.test(sample)) markers.push("csrf");
  if (/\blogin\b|sign in/i.test(sample)) markers.push("login");
  return markers;
}

function nextQuery(record: Record<string, unknown>): PageQuery | null {
  const cursor = firstCursor([record.next_cursor, dig(record, "meta", "next_cursor"), dig(record, "results", "next_cursor")]);
  if (cursor) return { cursor };
  const fromUrl = queryFromUrl(firstString([dig(record, "links", "next"), record.next_page_url]));
  if (fromUrl) return fromUrl;
  const current = firstNumber([dig(record, "meta", "current_page"), record.current_page]);
  const last = firstNumber([dig(record, "meta", "last_page"), record.last_page]);
  if (current !== null && last !== null && current < last) return { page: current + 1 };
  return null;
}

function queryFromUrl(value: string | null): PageQuery | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://placeholder.local");
    const cursor = url.searchParams.get("cursor");
    if (cursor && isCursor(cursor)) return { cursor };
    const page = url.searchParams.get("page");
    if (page && /^\d+$/.test(page)) {
      const number = Number(page);
      if (number > 0 && number < 10_000) return { page: number };
    }
  } catch {
    return null;
  }
  return null;
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.replace(/^\uFEFF/, "").trim().replace(/^\)\]\}',?\s*/, "");
  if (!trimmed) return { ok: false };
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (typeof value === "string") {
      const inner = value.trim();
      if (inner.startsWith("{") || inner.startsWith("[")) {
        try {
          return { ok: true, value: JSON.parse(inner) as unknown };
        } catch {
          return { ok: true, value };
        }
      }
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function looksLikeHtml(raw: string, mime: string): boolean {
  return mime === "text/html" || /^\s*(?:<!doctype|<html|<head|<body|<form|<title)\b/i.test(raw);
}

function safeContentType(value: string | null): string {
  const mime = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : "";
}

function safeKeys(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.keys(value)
    .slice(0, 20)
    .map((key) => (/^[A-Za-z0-9_.-]{1,40}$/.test(key) ? key : "[key]"));
}

function stripSensitive(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[redacted]")
    .replace(/(?:api[_-]?key|password|token|secret|authorization)\s*[:=]\s*\S+/gi, "[redacted]");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function clip(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
}

function firstCursor(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && isCursor(value)) return value;
  }
  return null;
}

function isCursor(value: string): boolean {
  return value.trim().length > 0 && value.length <= 500 && !/[\r\n]/.test(value);
}

function firstString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return null;
}

function dig(record: Record<string, unknown>, key: string, child: string): unknown {
  const value = record[key];
  if (!isRecord(value)) return undefined;
  return value[child];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
