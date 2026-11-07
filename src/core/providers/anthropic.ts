import { fetchWithRetry, stripUnsupportedConstraints, type HttpOptions } from "./http";
import { ProviderError, type CompletionRequest, type CompletionResult, type LLMProvider, type ProviderOptions } from "./types";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
export const ANTHROPIC_VERSION = "2023-06-01";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Yeni nesil Claude modelleri: sampling parametreleri (temperature) reddedilir, effort desteklenir. */
const CURRENT_GEN = /^claude-(opus-5|sonnet-5|haiku-5|fable-5|mythos-5)/;
/**
 * Sunucu tarafı ret-fallback'i ("default" biçimi) destekleyen modeller. Fallback yalnızca kullanıcı
 * Options'ta açıkça açarsa gönderilir (varsayılan KAPALI; eval'de her zaman kapalı). Kaynak: docs/DECISIONS.md.
 */
export const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5$|sonnet-5-5|fable-5-1)/;

export function supportsTemperature(model: string): boolean {
  return !CURRENT_GEN.test(model);
}

export function fallbackApplies(model: string, enabled: boolean): boolean {
  return enabled && FALLBACK_MODELS.test(model);
}

export function anthropicHeaders(apiKey: string, model?: string, refusalFallback = false): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    // Uzantıdan (tarayıcı bağlamı) doğrudan çağrı için gerekli; anahtar yalnızca kullanıcının kendi anahtarıdır.
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (model && fallbackApplies(model, refusalFallback)) h["anthropic-beta"] = FALLBACK_BETA;
  return h;
}

/**
 * Yapılandırılmış çıktı: output_config.format (json_schema). Not: güncel Claude modelleri
 * zorunlu tool_choice ("tool"/"any") ile 400 döndürdüğü için "submit_report" aracı yerine
 * JSON çıktı formatı kullanılır (docs/DECISIONS.md). Model hiçbir araca erişemez.
 */
export function buildAnthropicBody(req: CompletionRequest, opts: ProviderOptions = {}) {
  const current = CURRENT_GEN.test(req.model);
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    output_config: {
      format: { type: "json_schema", schema: stripUnsupportedConstraints(req.jsonSchema) },
      ...(current ? { effort: "medium" } : {}),
    },
  };
  if (!current) body.temperature = req.temperature; // eski modellerde deterministik örnekleme
  if (fallbackApplies(req.model, opts.refusalFallback === true)) body.fallbacks = "default";
  return body;
}

interface AnthropicMessage {
  model?: string;
  content?: { type: string; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function parseAnthropicMessage(data: AnthropicMessage): { raw: string; usage?: CompletionResult["usage"]; servedModel?: string } {
  if (data.stop_reason === "refusal") throw new ProviderError("refusal");
  const text = (data.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  if (!text) throw new ProviderError("empty_response");
  return {
    raw: text,
    usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
    servedModel: typeof data.model === "string" ? data.model : undefined,
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  constructor(private apiKey: string, private http: HttpOptions = {}, private opts: ProviderOptions = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const t0 = Date.now();
    const fb = this.opts.refusalFallback === true;
    const res = await fetchWithRetry(
      ANTHROPIC_URL,
      { method: "POST", headers: anthropicHeaders(this.apiKey, req.model, fb), body: JSON.stringify(buildAnthropicBody(req, this.opts)) },
      { ...this.http, signal: req.signal, secret: this.apiKey },
    );
    const parsed = parseAnthropicMessage((await res.json()) as AnthropicMessage);
    return {
      ...parsed,
      latencyMs: Date.now() - t0,
      temperature: supportsTemperature(req.model) ? req.temperature : "provider_default",
      refusalFallback: fallbackApplies(req.model, fb),
    };
  }

  async testKey(apiKey = this.apiKey): Promise<{ ok: boolean; message_tr: string }> {
    try {
      const h = anthropicHeaders(apiKey);
      delete h["content-type"];
      await fetchWithRetry(ANTHROPIC_MODELS_URL, { headers: h }, { ...this.http, retries: 0, secret: apiKey });
      return { ok: true, message_tr: "Anahtar geçerli (Anthropic)." };
    } catch (e) {
      return { ok: false, message_tr: e instanceof ProviderError ? e.message_tr : "Anahtar doğrulanamadı." };
    }
  }
}
