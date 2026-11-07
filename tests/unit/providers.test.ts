import { describe, it, expect, vi } from "vitest";
import { OpenAIProvider, OPENAI_URL } from "../../src/core/providers/openai";
import { AnthropicProvider, ANTHROPIC_URL, buildAnthropicBody } from "../../src/core/providers/anthropic";
import { GroqProvider } from "../../src/core/providers/groq";
import { createProvider, ProviderError, maskKey } from "../../src/core/providers";
import { maskSecrets, fetchWithRetry, stripUnsupportedConstraints } from "../../src/core/providers/http";
import { llmJsonSchema } from "../../src/core/schema";
import type { CompletionRequest } from "../../src/core/providers/types";

const KEY = "sk-proj-SECRETabcdefghijklmnop1234";
const ANT_KEY = "sk-ant-api03-SECRETxyzxyzxyz9876";
const req = (model = "gpt-4.1"): CompletionRequest => ({ system: "SYS", user: "USER", jsonSchema: llmJsonSchema(), model, temperature: 0, maxTokens: 4096 });

type Call = { url: string; init: RequestInit };
function mockFetch(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    return r;
  });
  return { fn, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const noSleep = async () => {};
const openaiOk = (content: string) => json({ choices: [{ message: { content, refusal: null } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

describe("OpenAIProvider", () => {
  it("strict json_schema, temperature 0, Bearer header gönderir", async () => {
    const { fn, calls } = mockFetch([openaiOk('{"a":1}')]);
    const p = new OpenAIProvider(KEY, { fetchImpl: fn, sleep: noSleep });
    const r = await p.complete(req());
    expect(r.raw).toBe('{"a":1}');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(calls[0]!.url).toBe(OPENAI_URL);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.tools).toBeUndefined();
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
  });
  it("refusal → ProviderError(refusal)", async () => {
    const { fn } = mockFetch([json({ choices: [{ message: { content: null, refusal: "no" } }] })]);
    await expect(new OpenAIProvider(KEY, { fetchImpl: fn }).complete(req())).rejects.toMatchObject({ code: "refusal" });
  });
  it("429 ve 500'de en fazla 2 kez yeniden dener", async () => {
    const { fn, calls } = mockFetch([json({}, 429), json({}, 503), openaiOk("{}")]);
    await new OpenAIProvider(KEY, { fetchImpl: fn, sleep: noSleep }).complete(req());
    expect(calls).toHaveLength(3);
    const f2 = mockFetch([json({}, 500)]);
    await expect(new OpenAIProvider(KEY, { fetchImpl: f2.fn, sleep: noSleep }).complete(req())).rejects.toMatchObject({ code: "server" });
    expect(f2.calls).toHaveLength(3);
  });
  it("401 yeniden denenmez ve hata mesajında anahtar yer almaz", async () => {
    const { fn, calls } = mockFetch([json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401)]);
    const spy = vi.spyOn(console, "error");
    try {
      await new OpenAIProvider(KEY, { fetchImpl: fn, sleep: noSleep }).complete(req());
      expect.fail("hata bekleniyordu");
    } catch (e) {
      const err = e as ProviderError;
      expect(err.code).toBe("auth");
      expect(err.message).not.toContain(KEY);
      expect(err.message).toContain("sk-proj-…1234");
      expect(err.message_tr).toContain("API anahtarı geçersiz");
      expect(JSON.stringify(err)).not.toContain("SECRET");
    }
    expect(calls).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  });
  it("ağ hatası → network, timeout → timeout", async () => {
    const { fn } = mockFetch([new TypeError("fail")]);
    await expect(new OpenAIProvider(KEY, { fetchImpl: fn, sleep: noSleep }).complete(req())).rejects.toMatchObject({ code: "network" });
    const slow = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError")))));
    await expect(fetchWithRetry("https://x", {}, { fetchImpl: slow, timeoutMs: 5, retries: 0 })).rejects.toMatchObject({ code: "timeout" });
  });
  it("kullanıcı iptali → cancelled", async () => {
    const ac = new AbortController();
    ac.abort();
    const { fn } = mockFetch([openaiOk("{}")]);
    await expect(new OpenAIProvider(KEY, { fetchImpl: fn }).complete({ ...req(), signal: ac.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
  it("testKey models endpoint'ini çağırır", async () => {
    const { fn, calls } = mockFetch([json({ data: [] })]);
    expect((await new OpenAIProvider(KEY, { fetchImpl: fn }).testKey()).ok).toBe(true);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/models");
  });
});

describe("AnthropicProvider", () => {
  const msg = (text: string, extra: object = {}) => json({ content: [{ type: "thinking", thinking: "" }, { type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 4 }, ...extra });
  it("gerekli header'ları gönderir (x-api-key, version, direct-browser-access)", async () => {
    const { fn, calls } = mockFetch([msg('{"x":1}')]);
    const r = await new AnthropicProvider(ANT_KEY, { fetchImpl: fn }).complete(req("claude-opus-5-5"));
    expect(r.raw).toBe('{"x":1}');
    expect(calls[0]!.url).toBe(ANTHROPIC_URL);
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe(ANT_KEY);
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(h.authorization).toBeUndefined();
  });
  it("yapılandırılmış çıktı output_config.format ile; zorunlu tool_choice ve araç yok", async () => {
    const body = buildAnthropicBody(req("claude-opus-5-5"));
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" }, effort: "medium" });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("temperature"); // güncel modellerde sampling parametresi 400 döner
    expect(body).not.toHaveProperty("fallbacks"); // ret-fallback varsayılan KAPALI
    expect(JSON.stringify(body)).not.toMatch(/minLength|maxLength|"maximum"|"pattern"/);
  });
  it("eski model: temperature gönderilir, fallback/effort yok", () => {
    const body = buildAnthropicBody(req("claude-haiku-4-5"));
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty("fallbacks");
  });
  it("refusal stop_reason → ProviderError(refusal)", async () => {
    const { fn } = mockFetch([json({ content: [], stop_reason: "refusal" })]);
    await expect(new AnthropicProvider(ANT_KEY, { fetchImpl: fn }).complete(req("claude-opus-5-5"))).rejects.toMatchObject({ code: "refusal" });
  });
  it("testKey /v1/models çağırır", async () => {
    const { fn, calls } = mockFetch([json({ data: [] }, 401)]);
    const r = await new AnthropicProvider(ANT_KEY, { fetchImpl: fn }).testKey();
    expect(r.ok).toBe(false);
    expect(r.message_tr).not.toContain(ANT_KEY);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/models");
  });
});

describe("GroqProvider", () => {
  it("json_schema desteklenmezse json_object'e düşer ve şemayı system prompt'a ekler", async () => {
    const { fn, calls } = mockFetch([json({ error: { message: "response_format json_schema is not supported for this model" } }, 400), openaiOk("{}")]);
    await new GroqProvider("gsk_abcdefghijklmnop1234", { fetchImpl: fn, sleep: noSleep }).complete(req("llama-3.3-70b-versatile"));
    expect(calls).toHaveLength(2);
    const b2 = JSON.parse(calls[1]!.init.body as string);
    expect(b2.response_format).toEqual({ type: "json_object" });
    expect(b2.messages[0].content).toContain("JSON schema to follow exactly");
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
  });
  it("diğer 400 hataları düşüş yapmaz", async () => {
    const { fn, calls } = mockFetch([json({ error: { message: "model not found" } }, 400)]);
    await expect(new GroqProvider("gsk_x", { fetchImpl: fn }).complete(req())).rejects.toMatchObject({ code: "bad_request" });
    expect(calls).toHaveLength(1);
  });
});

describe("yardımcılar", () => {
  it("maskKey / maskSecrets", () => {
    expect(maskKey(KEY)).toBe("sk-proj-…1234");
    expect(maskKey("gsk_abcdef9999")).toBe("gsk_…9999");
    expect(maskSecrets(`key=${ANT_KEY} other sk-abcdefghijkl5678`)).not.toMatch(/SECRET|abcdefghijkl5678/);
  });
  it("createProvider fabrikası", () => {
    expect(createProvider("openai", KEY).id).toBe("openai");
    expect(createProvider("anthropic", KEY).id).toBe("anthropic");
    expect(createProvider("groq", KEY).id).toBe("groq");
    expect(createProvider("mock", "", { mock: ["{}"] }).id).toBe("mock");
  });
  it("stripUnsupportedConstraints 'properties' altındaki alan adlarını korur", () => {
    const s = stripUnsupportedConstraints({ type: "object", properties: { pattern: { type: "string", minLength: 2 } }, required: ["pattern"] });
    expect(s).toEqual({ type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] });
  });
});
