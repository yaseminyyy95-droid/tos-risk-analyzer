import { fetchWithRetry, type HttpOptions } from "./http";
import { buildChatBody, parseChatCompletion } from "./openai";
import { ProviderError, type CompletionRequest, type CompletionResult, type LLMProvider } from "./types";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

/** Groq (OpenAI uyumlu). Önce json_schema; model desteklemiyorsa (400) json_object'e düşer. */
export class GroqProvider implements LLMProvider {
  readonly id = "groq" as const;
  constructor(private apiKey: string, private http: HttpOptions = {}) {}

  private async call(req: CompletionRequest, fmt: "json_schema" | "json_object"): Promise<Response> {
    return fetchWithRetry(
      GROQ_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(buildChatBody(req, fmt)),
      },
      { ...this.http, signal: req.signal, secret: this.apiKey },
    );
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await this.call(req, "json_schema");
    } catch (e) {
      if (e instanceof ProviderError && e.code === "bad_request" && /json_schema|response_format|not supported|unsupported/i.test(e.message)) {
        res = await this.call(req, "json_object");
      } else throw e;
    }
    const parsed = parseChatCompletion(await res.json());
    return { ...parsed, latencyMs: Date.now() - t0 };
  }

  async testKey(apiKey = this.apiKey): Promise<{ ok: boolean; message_tr: string }> {
    try {
      await fetchWithRetry(GROQ_MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` } }, { ...this.http, retries: 0, secret: apiKey });
      return { ok: true, message_tr: "Anahtar geçerli (Groq)." };
    } catch (e) {
      return { ok: false, message_tr: e instanceof ProviderError ? e.message_tr : "Anahtar doğrulanamadı." };
    }
  }
}
