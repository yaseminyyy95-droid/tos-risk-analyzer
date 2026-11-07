import { fetchWithRetry, stripUnsupportedConstraints, type HttpOptions } from "./http";
import { ProviderError, type CompletionRequest, type CompletionResult, type LLMProvider } from "./types";

export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** OpenAI-uyumlu chat completions gövdesi (OpenAI + Groq). */
export function buildChatBody(req: CompletionRequest, responseFormat: "json_schema" | "json_object") {
  const system = responseFormat === "json_object" ? `${req.system}\n\nJSON schema to follow exactly:\n${JSON.stringify(req.jsonSchema)}` : req.system;
  return {
    model: req.model,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: req.user },
    ],
    response_format:
      responseFormat === "json_schema"
        ? { type: "json_schema", json_schema: { name: "tos_risk_report", strict: true, schema: stripUnsupportedConstraints(req.jsonSchema) } }
        : { type: "json_object" },
  };
}

export function parseChatCompletion(data: ChatCompletion): { raw: string; usage?: CompletionResult["usage"] } {
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new ProviderError("refusal");
  const raw = choice?.message?.content;
  if (!raw) throw new ProviderError("empty_response");
  return { raw, usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens } };
}

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai" as const;
  constructor(private apiKey: string, private http: HttpOptions = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const t0 = Date.now();
    const res = await fetchWithRetry(
      OPENAI_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(buildChatBody(req, "json_schema")),
      },
      { ...this.http, signal: req.signal, secret: this.apiKey },
    );
    const parsed = parseChatCompletion((await res.json()) as ChatCompletion);
    return { ...parsed, latencyMs: Date.now() - t0 };
  }

  async testKey(apiKey = this.apiKey): Promise<{ ok: boolean; message_tr: string }> {
    try {
      await fetchWithRetry(OPENAI_MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` } }, { ...this.http, retries: 0, secret: apiKey });
      return { ok: true, message_tr: "Anahtar geçerli (OpenAI)." };
    } catch (e) {
      return { ok: false, message_tr: e instanceof ProviderError ? e.message_tr : "Anahtar doğrulanamadı." };
    }
  }
}
