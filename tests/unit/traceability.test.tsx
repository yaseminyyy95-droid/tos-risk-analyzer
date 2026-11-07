// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "preact";
import { AnthropicProvider, buildAnthropicBody, anthropicHeaders } from "../../src/core/providers/anthropic";
import { OpenAIProvider } from "../../src/core/providers/openai";
import { GroqProvider } from "../../src/core/providers/groq";
import { createProvider, MockProvider } from "../../src/core/providers";
import { llmJsonSchema } from "../../src/core/schema";
import { analyzeDocument, modelMatches, failedReport } from "../../src/core/pipeline";
import { normalizeSettings, DEFAULT_SETTINGS } from "../../src/background/settings";
import { EVAL_PROVIDER_OPTIONS } from "../../eval/scripts/run";
import { ReportView } from "../../src/ui/components/Report";
import { reportToMarkdown } from "../../src/ui/export";
import { makeDoc, NEUTRAL, ARB, llmReport, finding } from "./helpers/factory";
import type { CompletionRequest } from "../../src/core/providers/types";

const req = (model: string): CompletionRequest => ({ system: "S", user: "U", jsonSchema: llmJsonSchema(), model, temperature: 0, maxTokens: 100 });
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const capture = (body: unknown) => {
  const calls: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = async (_u: string, init?: RequestInit) => {
    calls.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return json(body);
  };
  return { calls, fetchImpl };
};
const antMsg = (model: string) => ({ model, content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: {} });

describe("Anthropic ret-fallback ayarı", () => {
  it("varsayılan KAPALI: fallbacks gövdesi ve beta header gönderilmez", async () => {
    expect(DEFAULT_SETTINGS.refusalFallback).toBe(false);
    expect(normalizeSettings({}).refusalFallback).toBe(false);
    expect(buildAnthropicBody(req("claude-opus-5-5"))).not.toHaveProperty("fallbacks");
    expect(anthropicHeaders("k", "claude-opus-5-5")).not.toHaveProperty("anthropic-beta");
    const c = capture(antMsg("claude-opus-5-5"));
    const r = await new AnthropicProvider("sk-ant-x", { fetchImpl: c.fetchImpl }).complete(req("claude-opus-5-5"));
    expect(c.calls[0]!.body).not.toHaveProperty("fallbacks");
    expect(c.calls[0]!.headers["anthropic-beta"]).toBeUndefined();
    expect(r.refusalFallback).toBe(false);
  });
  it("ayar açıkken destekleyen modelde gönderilir, desteklemeyen modelde gönderilmez", async () => {
    const c = capture(antMsg("claude-opus-5-5"));
    const p = createProvider("anthropic", "sk-ant-x", { fetchImpl: c.fetchImpl, refusalFallback: true });
    const r = await p.complete(req("claude-opus-5-5"));
    expect(c.calls[0]!.body.fallbacks).toBe("default");
    expect(c.calls[0]!.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(r.refusalFallback).toBe(true);
    expect(buildAnthropicBody(req("claude-haiku-5-5"), { refusalFallback: true })).not.toHaveProperty("fallbacks");
  });
  it("eval çalıştırmalarında fallback her zaman kapalı", () => {
    expect(EVAL_PROVIDER_OPTIONS.refusalFallback).toBe(false);
  });
});

describe("servedModel ve temperature izlenebilirliği", () => {
  it("OpenAI / Groq / Anthropic yanıtındaki gerçek model alanını döndürür", async () => {
    const o = capture({ model: "gpt-4.1-2025-04-14", choices: [{ message: { content: "{}" } }] });
    expect((await new OpenAIProvider("sk-x", { fetchImpl: o.fetchImpl }).complete(req("gpt-4.1"))).servedModel).toBe("gpt-4.1-2025-04-14");
    const g = capture({ model: "openai/gpt-oss-120b", choices: [{ message: { content: "{}" } }] });
    expect((await new GroqProvider("gsk_x", { fetchImpl: g.fetchImpl }).complete(req("openai/gpt-oss-120b"))).servedModel).toBe("openai/gpt-oss-120b");
    const a = capture(antMsg("claude-opus-4-8"));
    const ar = await new AnthropicProvider("sk-ant-x", { fetchImpl: a.fetchImpl }).complete(req("claude-opus-5-5"));
    expect(ar.servedModel).toBe("claude-opus-4-8");
  });
  it("temperature gönderilemeyen modellerde provider_default", async () => {
    const a = capture(antMsg("claude-opus-5-5"));
    expect((await new AnthropicProvider("k", { fetchImpl: a.fetchImpl }).complete(req("claude-opus-5-5"))).temperature).toBe("provider_default");
    const b = capture(antMsg("claude-haiku-4-5"));
    expect((await new AnthropicProvider("k", { fetchImpl: b.fetchImpl }).complete(req("claude-haiku-4-5"))).temperature).toBe(0);
    const o = capture({ model: "gpt-4.1", choices: [{ message: { content: "{}" } }] });
    expect((await new OpenAIProvider("k", { fetchImpl: o.fetchImpl }).complete(req("gpt-4.1"))).temperature).toBe(0);
  });
  it("modelMatches sürüm eklerini uyuşmazlık saymaz", () => {
    expect(modelMatches("gpt-4.1", "gpt-4.1-2025-04-14")).toBe(true);
    expect(modelMatches("claude-opus-5-5", "claude-opus-5-5")).toBe(true);
    expect(modelMatches("claude-opus-5-5", "claude-opus-4-8")).toBe(false);
    expect(modelMatches("gpt-4.1", "gpt-4.1-mini")).toBe(true); // bilinen sınır: önek eşleşmesi
  });
  it("pipeline: servedModel ve meta rapora işlenir; farklı model → uyuşmazlık", async () => {
    const doc = makeDoc([ARB + " " + NEUTRAL, NEUTRAL + " " + NEUTRAL]);
    const resp = (r: CompletionRequest) => JSON.stringify(llmReport([finding(ARB, /\[(S\d+)\]/.exec(r.user)![1]!)], { llm_suggested_score: 35 }));
    const same = await analyzeDocument(doc, new MockProvider(resp), { model: "claude-opus-5-5" });
    expect(same.report.servedModel).toBe("claude-opus-5-5");
    expect(same.report.meta).toEqual({ temperature: 0, refusalFallback: false, servedModelMismatch: false });
    const m = new MockProvider(resp);
    m.servedModel = "claude-opus-4-8";
    const diff = await analyzeDocument(doc, m, { model: "claude-opus-5-5" });
    expect(diff.report.servedModel).toBe("claude-opus-4-8");
    expect(diff.report.meta.servedModelMismatch).toBe(true);
    expect(diff.diagnostics.rawResponses[0]!.servedModel).toBe("claude-opus-4-8");
  });
  it("UI uyuşmazlıkta uyarı gösterir; export yanıtlayan modeli ve temperature'ı yazar", () => {
    const base = failedReport({ url: "https://x.example/t", title: "T", legalPageConfidence: 0.9, stats: { totalChars: 9, visibleChars: 9, quarantinedChars: 0 } }, "provider_error", "anthropic", "claude-opus-5-5");
    const rep = { ...base, servedModel: "claude-opus-4-8", meta: { temperature: "provider_default" as const, refusalFallback: true, servedModelMismatch: true } };
    const root = document.createElement("div");
    render(<ReportView report={rep} developerMode={false} onShow={() => {}} fromCache={false} />, root);
    expect(root.querySelector('[data-cy="model-mismatch"]')!.textContent).toContain("claude-opus-4-8");
    const md = reportToMarkdown(rep);
    expect(md).toContain("Yanıtlayan model: claude-opus-4-8 (⚠ istenenden farklı)");
    expect(md).toContain("temperature: provider_default");
    const ok = { ...base, servedModel: "claude-opus-5-5" };
    const root2 = document.createElement("div");
    render(<ReportView report={ok} developerMode={false} onShow={() => {}} fromCache={false} />, root2);
    expect(root2.querySelector('[data-cy="model-mismatch"]')).toBeNull();
  });
});
