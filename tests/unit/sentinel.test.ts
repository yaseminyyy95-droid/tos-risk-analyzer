import { describe, it, expect } from "vitest";
import { findSentinelHints } from "../../src/core/sentinel";
import { segmentBlocks } from "../../src/core/segment";
import { ARB, RENEW, LICENSE, block } from "./helpers/factory";

const { segments } = segmentBlocks([block(ARB), block(RENEW), block(LICENSE), block("We may change these Terms at any time without notice to you or anyone.")]);

describe("sentinel", () => {
  it("doğrulanmış bulgusu olmayan kategoriler için ipucu üretir", () => {
    const hints = findSentinelHints(segments, new Set(["arbitration_class_waiver"]), new Set());
    const cats = hints.map((h) => h.category).sort();
    expect(cats).toEqual(["auto_renewal", "content_license_ip", "unilateral_changes"]);
    expect(hints.find((h) => h.category === "unilateral_changes")!.matchedText).toContain("without notice");
  });
  it("tüm kategoriler doğrulanmışsa ipucu yok", () => {
    const all = new Set(["arbitration_class_waiver", "auto_renewal", "content_license_ip", "unilateral_changes"]);
    expect(findSentinelHints(segments, all, new Set())).toHaveLength(0);
  });
  it("flag'li segmentler taranmaz", () => {
    const ids = new Set(segments.map((s) => s.id));
    expect(findSentinelHints(segments, new Set(), ids)).toHaveLength(0);
  });
  it("Türkçe anahtar kelimeler", () => {
    const tr = segmentBlocks([block("Aboneliğiniz her ay otomatik olarak yenilenir. Ödemeler iade edilmez.")]).segments;
    expect(findSentinelHints(tr, new Set(), new Set()).map((h) => h.category).sort()).toEqual(["auto_renewal", "cancellation_refund"]);
  });
});
