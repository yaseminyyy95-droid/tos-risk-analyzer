import type { CompletionRequest, CompletionResult, LLMProvider } from "./types";

export type MockResponder = (req: CompletionRequest, callIndex: number) => string | Promise<string>;

/**
 * Anahtarsız test / eval sağlayıcısı. Yanıtlar: sıralı dizi, sözlük (fixture adı / doküman hash'i)
 * veya fonksiyon. Eval'de eval/runs/<run>/raw/*.json kayıtlarını replay etmek için de kullanılır.
 */
export class MockProvider implements LLMProvider {
  readonly id = "mock" as const;
  readonly calls: CompletionRequest[] = [];
  private responder: MockResponder;

  constructor(responses: string[] | MockResponder) {
    this.responder = Array.isArray(responses)
      ? (_req, i) => {
          const r = responses[Math.min(i, responses.length - 1)];
          if (r === undefined) throw new Error("MockProvider: yanıt yok");
          return r;
        }
      : responses;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (req.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const idx = this.calls.length;
    this.calls.push(req);
    const t0 = Date.now();
    const raw = await this.responder(req, idx);
    return { raw, latencyMs: Date.now() - t0, usage: { inputTokens: Math.ceil((req.system.length + req.user.length) / 4), outputTokens: Math.ceil(raw.length / 4) } };
  }

  async testKey(): Promise<{ ok: boolean; message_tr: string }> {
    return { ok: true, message_tr: "Mock sağlayıcı (anahtar gerekmez)." };
  }
}

/** user prompt içinden "[S012] metin" satırlarını çıkarır — mock yanıt üreticileri için. */
export function segmentsFromPrompt(user: string): { id: string; text: string; flagged: boolean }[] {
  const out: { id: string; text: string; flagged: boolean }[] = [];
  const re = /^\[(S\d{3,4})\] (⚠ FLAGGED_AS_POSSIBLE_INJECTION )?(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(user))) out.push({ id: m[1]!, text: m[3]!, flagged: Boolean(m[2]) });
  return out;
}
