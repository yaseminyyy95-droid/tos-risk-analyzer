import { ProviderError, type ProviderErrorCode } from "./types";

export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_RETRIES = 2;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  retries?: number;
  /** test için: bekleme fonksiyonu */
  sleep?: (ms: number) => Promise<void>;
}

/** Metindeki API anahtarlarını maskeler (sk-…abcd). Hata mesajları ve loglar için. */
export function maskSecrets(text: string, ...secrets: (string | undefined)[]): string {
  let t = text;
  for (const s of secrets) {
    if (s && s.length >= 6) t = t.split(s).join(maskKey(s));
  }
  return t
    .replace(/\b(sk-(?:ant-|proj-)?)[A-Za-z0-9_-]{6,}([A-Za-z0-9]{4})\b/g, "$1…$2")
    .replace(/\b(gsk_)[A-Za-z0-9]{6,}([A-Za-z0-9]{4})\b/g, "$1…$2");
}

export function maskKey(key: string): string {
  if (!key) return "";
  const prefix = /^(sk-ant-|sk-proj-|sk-|gsk_)/.exec(key)?.[1] ?? "";
  return `${prefix}…${key.slice(-4)}`;
}

export function statusToCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fetch + 60 sn timeout + 429/5xx için en fazla 2 üstel backoff. Kullanıcı iptali → "cancelled".
 * Dönen Response başarılıdır (ok); aksi halde ProviderError fırlatılır (anahtar maskelenmiş).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: HttpOptions & { signal?: AbortSignal; secret?: string },
): Promise<Response> {
  const f = opts.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retries ?? MAX_RETRIES;
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new ProviderError("cancelled");
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await f(url, { ...init, signal: ac.signal });
    } catch {
      if (opts.signal?.aborted) throw new ProviderError("cancelled");
      if (timedOut) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new ProviderError("timeout");
      }
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new ProviderError("network");
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : 500 * 2 ** attempt);
      continue;
    }
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* gövde okunamadı */
    }
    throw new ProviderError(statusToCode(res.status), { status: res.status, detail: maskSecrets(detail, opts.secret) });
  }
}

const UNSUPPORTED_KEYWORDS = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "pattern", "minItems", "maxItems", "$schema", "default"]);

/**
 * Sağlayıcıların structured-output modlarının desteklemediği kısıt anahtar kelimelerini çıkarır.
 * Kısıtlar istemci tarafında Zod (LLMReportSchema) ile yine de birebir doğrulanır.
 */
export function stripUnsupportedConstraints<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => stripUnsupportedConstraints(s)) as T;
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYWORDS.has(k)) continue;
      out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, stripUnsupportedConstraints(pv)])) : stripUnsupportedConstraints(v);
    }
    return out as T;
  }
  return schema;
}
