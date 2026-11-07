import { describe, it, expect } from "vitest";
import { decideStatus, type StatusInput } from "../../src/core/status";

const base: StatusInput = {
  failure: null, heuristicInjection: false, llmInjectionSuspected: false, hiddenWithInstructions: 0,
  modelPossiblyInfluenced: false, groundingRate: 1, proposedCount: 6, truncated: false, documentType: "terms_of_service",
  legalPageConfidence: 0.9, visibleChars: 10000, scoreDivergent: false, llmSuggestedScore: 70, score: 72,
  sentinelCount: 0, rejectedCount: 0, failedChunks: 0, totalChunks: 1,
};

describe("status karar tablosu", () => {
  it("OK", () => expect(decideStatus(base).status).toBe("OK"));
  it.each([
    ["canary_leak", "sızdırdı"],
    ["schema_invalid", "biçime"],
    ["provider_error", "sağlayıcı"],
    ["no_api_key", "API anahtarı"],
  ] as const)("FAILED: %s", (code, text) => {
    const r = decideStatus({ ...base, failure: { code } });
    expect(r.status).toBe("FAILED");
    expect(r.reasons_tr.join(" ")).toContain(text);
  });
  it.each<[string, Partial<StatusInput>, string]>([
    ["heuristik injection", { heuristicInjection: true }, "Prompt injection"],
    ["LLM injection", { llmInjectionSuspected: true }, "Prompt injection"],
    ["gizli talimat", { hiddenWithInstructions: 2 }, "2 gizli blokta"],
    ["model etkilenmiş", { modelPossiblyInfluenced: true }, "Model etkilenmiş"],
    ["düşük grounding", { groundingRate: 0.5, proposedCount: 4 }, "%50"],
    ["kırpma", { truncated: true }, "kırpıldı"],
    ["hukuki değil", { documentType: "not_legal_document" }, "hukuki metin"],
    ["düşük sayfa güveni", { legalPageConfidence: 0.2 }, "hukuki metin"],
    ["az metin", { visibleChars: 900 }, "çok az metin"],
    ["skor sapması", { scoreDivergent: true, llmSuggestedScore: 0, score: 35 }, "sapma"],
    ["sentinel", { sentinelCount: 2 }, "kaçırmış"],
  ])("UNCERTAIN: %s", (_n, patch, text) => {
    const r = decideStatus({ ...base, ...patch });
    expect(r.status).toBe("UNCERTAIN");
    expect(r.reasons_tr.join(" ")).toContain(text);
  });
  it("düşük grounding ama < 3 öneri → UNCERTAIN değil", () => {
    expect(decideStatus({ ...base, groundingRate: 0.5, proposedCount: 2, rejectedCount: 1 }).status).toBe("PARTIAL");
  });
  it("PARTIAL: reddedilen bulgu veya tek chunk başarısız", () => {
    expect(decideStatus({ ...base, rejectedCount: 1 }).status).toBe("PARTIAL");
    expect(decideStatus({ ...base, failedChunks: 1, totalChunks: 3 }).reasons_tr[0]).toContain("3 bölümden 1");
  });
  it("UNCERTAIN gerekçelerine PARTIAL gerekçeleri de eklenir", () => {
    const r = decideStatus({ ...base, heuristicInjection: true, rejectedCount: 3 });
    expect(r.reasons_tr.some((x) => x.includes("3 iddia"))).toBe(true);
  });
});
