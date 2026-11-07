import { describe, it, expect } from "vitest";
import { matchFindings, locateInCanonical } from "../../eval/scripts/score";
import { injectHtml, ATTACKS } from "../../eval/scripts/adversarial";
import type { DocRunRecord } from "../../eval/scripts/run";
import type { GoldFile } from "../../eval/scripts/validate-gold";

const canonical = "Section A. You agree to binding individual arbitration and waive class actions.\n\nSection B. Fees are non-refundable for any reason whatsoever.\n\nSection C. We may sell your personal information to partners.";
const seg = (id: string, needle: string) => {
  const s = canonical.indexOf(needle);
  return { id, charStart: s, charEnd: s + needle.length };
};
const finding = (id: string, category: string, quote: string, severity = "critical") => ({ id, category, quote, severity }) as never;

function rec(findings: ReturnType<typeof finding>[]): DocRunRecord {
  return {
    docId: "d",
    repeat: 1,
    canonicalText: canonical,
    findingSpans: [],
    segments: [seg("S001", canonical.split("\n\n")[0]!), seg("S002", canonical.split("\n\n")[1]!), seg("S003", canonical.split("\n\n")[2]!)],
    rejected: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs: 0,
    requestedModel: "m",
    servedModel: "m",
    servedModelMismatch: false,
    temperature: 0,
    report: { findings } as never,
  };
}
const gold: GoldFile = {
  docId: "d",
  annotationStatus: "draft",
  annotator: "t",
  items: [
    { goldId: "G1", category: "arbitration_class_waiver", severity: "critical", anchorQuote: "binding individual arbitration and waive class actions", acceptableCategories: ["arbitration_class_waiver"] },
    { goldId: "G2", category: "cancellation_refund", severity: "high", anchorQuote: "Fees are non-refundable for any reason", acceptableCategories: ["cancellation_refund"] },
    { goldId: "G3", category: "data_sale_or_sharing", severity: "critical", anchorQuote: "We may sell your personal information", acceptableCategories: ["data_sale_or_sharing"] },
  ],
};

describe("eval: eşleştirme", () => {
  it("çakışan span + kabul edilen kategori → TP; yanlış kategori → FP+FN", () => {
    const m = matchFindings(
      rec([
        finding("F1", "arbitration_class_waiver", "You agree to binding individual arbitration"),
        finding("F2", "other", "Fees are non-refundable for any reason whatsoever"),
      ]),
      gold,
    );
    expect(m.tp.map((t) => t.goldId)).toEqual(["G1"]);
    expect(m.fp.map((f) => f.findingId)).toEqual(["F2"]);
    expect(m.fn.map((f) => f.goldId).sort()).toEqual(["G2", "G3"]);
  });
  it("çakışmasız ama aynı segmentte ≤150 karakter → TP; bire-bir eşleşme", () => {
    const m = matchFindings(rec([finding("F1", "data_sale_or_sharing", "to partners."), finding("F2", "data_sale_or_sharing", "We may sell your personal information")]), gold);
    expect(m.tp).toHaveLength(1);
    expect(m.tp[0]!.findingId).toBe("F2"); // en büyük çakışma önce
    expect(m.fp).toHaveLength(1);
  });
  it("severity uyumu işaretlenir; locateInCanonical normalize eder", () => {
    const m = matchFindings(rec([finding("F1", "cancellation_refund", "Fees are non-refundable", "low")]), gold);
    expect(m.tp[0]!.severityMatch).toBe(false);
    expect(locateInCanonical(canonical, "fees  are")).toBeNull();
    expect(locateInCanonical(canonical, "Fees\u00A0are")).not.toBeNull();
  });
});

describe("eval: adversarial enjeksiyon", () => {
  it("</main> öncesine ekler ve 5 saldırı türü vardır", () => {
    expect(injectHtml("<main><p>x</p></main>", "<p>A</p>")).toBe("<main><p>x</p><p>A</p>\n</main>");
    expect(ATTACKS.map((a) => a.id)).toEqual(["visible_ignore", "hidden_white", "fake_delimiter", "turkish", "vendor_certified"]);
  });
});
