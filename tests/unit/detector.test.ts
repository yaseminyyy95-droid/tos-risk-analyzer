import { describe, it, expect } from "vitest";
import { legalPageConfidence } from "../../src/content/detector";

const legalText = "These Terms are governed by the governing law of Delaware. Arbitration. Personal data. Liability. You agree. Third parties. Refund. License. ".repeat(10);

describe("detector", () => {
  it("hukuki URL + başlık + anahtar kelimeler → yüksek güven", () => {
    expect(legalPageConfidence({ url: "https://x.com/legal/terms", title: "Terms of Service", h1: "Terms of Service", text: legalText })).toBeGreaterThan(0.8);
  });
  it("Türkçe KVKK sayfası", () => {
    const tr = "Kişisel veri işleme. Veri sorumlusu. Açık rıza. Yürürlük. Sözleşme. Uyuşmazlık. Gizlilik. ".repeat(15);
    expect(legalPageConfidence({ url: "https://x.com.tr/kvkk", title: "KVKK Aydınlatma Metni", h1: "", text: tr })).toBeGreaterThan(0.6);
  });
  it("haber/blog sayfası → düşük güven", () => {
    const blog = "Today we launched a new feature for photo editing with filters and stickers. ".repeat(20);
    expect(legalPageConfidence({ url: "https://x.com/blog/new-feature", title: "New feature!", h1: "Launch", text: blog })).toBeLessThan(0.4);
  });
  it("kısa metin cezalandırılır", () => {
    expect(legalPageConfidence({ url: "https://x.com/terms", title: "Terms", h1: "", text: "short" })).toBeLessThan(0.4);
  });
});
