export type LLMProviderId = "openai" | "anthropic" | "groq" | "mock";

export interface CompletionRequest {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  model: string;
  temperature: 0;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface CompletionUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type TemperatureSetting = 0 | "provider_default";

export interface CompletionResult {
  raw: string;
  usage?: CompletionUsage;
  latencyMs: number;
  /** API yanıtındaki gerçek `model` alanı (yoksa undefined) */
  servedModel?: string;
  /** İstekte gönderilen temperature; gönderilemediyse "provider_default" */
  temperature?: TemperatureSetting;
  /** Bu çağrıda sunucu tarafı ret-fallback'i açık mıydı */
  refusalFallback?: boolean;
}

export interface ProviderOptions {
  /** Anthropic: model reddederse sunucu tarafında başka bir modele geç (varsayılan KAPALI) */
  refusalFallback?: boolean;
}

export interface LLMProvider {
  id: LLMProviderId;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  testKey(apiKey?: string): Promise<{ ok: boolean; message_tr: string }>;
}

export type ProviderErrorCode =
  | "auth"
  | "rate_limit"
  | "server"
  | "network"
  | "timeout"
  | "bad_request"
  | "refusal"
  | "cancelled"
  | "empty_response"
  | "unknown";

export const PROVIDER_ERROR_TR: Record<ProviderErrorCode, string> = {
  auth: "API anahtarı geçersiz veya yetkisiz.",
  rate_limit: "Sağlayıcı istek sınırına ulaşıldı; biraz sonra tekrar deneyin.",
  server: "Sağlayıcı sunucusu hata döndürdü.",
  network: "Ağ hatası: sağlayıcıya ulaşılamadı.",
  timeout: "İstek zaman aşımına uğradı (60 sn).",
  bad_request: "Sağlayıcı isteği reddetti (model adı veya parametreler hatalı olabilir).",
  refusal: "Model isteği yanıtlamayı reddetti.",
  cancelled: "Analiz iptal edildi.",
  empty_response: "Sağlayıcı boş yanıt döndürdü.",
  unknown: "Bilinmeyen sağlayıcı hatası.",
};

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly message_tr: string;
  constructor(code: ProviderErrorCode, opts: { status?: number; detail?: string } = {}) {
    // detail asla API anahtarı içermez (bkz. maskSecrets)
    super(`${code}${opts.status ? ` (${opts.status})` : ""}${opts.detail ? `: ${opts.detail}` : ""}`);
    this.name = "ProviderError";
    this.code = code;
    this.status = opts.status;
    this.message_tr = PROVIDER_ERROR_TR[code] + (opts.status ? ` (HTTP ${opts.status})` : "");
  }
}
