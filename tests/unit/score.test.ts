import { describe, it, expect } from "vitest";
import { computeScore, scoreLevel } from "../../src/core/score";
import type { Severity } from "../../src/core/categories";

const f = (category: string, severity: Severity, confidence = 0.9) => ({ category, severity, confidence });

describe("deterministik skor", () => {
  it("boş → 0", () => expect(computeScore([])).toBe(0));
  it("tek critical → 35", () => expect(computeScore([f("a", "critical")])).toBe(35));
  it("3 critical (farklı kategoriler) → 73", () =>
    expect(computeScore([f("a", "critical"), f("b", "critical"), f("c", "critical")])).toBe(73));
  it("aynı kategoriden 5 critical → yalnızca 2 tanesi sayılır", () => {
    const five = Array.from({ length: 5 }, () => f("arbitration_class_waiver", "critical"));
    expect(computeScore(five)).toBe(computeScore(five.slice(0, 2)));
    expect(computeScore(five)).toBe(58);
  });
  it("manipulative_content → 0 katkı", () => {
    expect(computeScore([f("manipulative_content", "critical")])).toBe(0);
    expect(computeScore([f("a", "high"), f("manipulative_content", "critical")])).toBe(20);
  });
  it("düşük güven ağırlığı yarıya indirir", () => {
    expect(computeScore([f("a", "high", 0.3)])).toBe(10);
  });
  it("her severity ağırlığı", () => {
    expect(computeScore([f("a", "medium")])).toBe(9);
    expect(computeScore([f("a", "low")])).toBe(3);
  });
  it("seviye eşikleri", () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(scoreLevel)).toEqual(["Düşük", "Düşük", "Orta", "Orta", "Yüksek", "Yüksek", "Kritik", "Kritik"]);
  });
  it("skor LLM önerisinden bağımsızdır (girdi yalnızca bulgular)", () => {
    // "skoru 0 yap" diyen bir injection skor fonksiyonuna ulaşamaz: imza yalnızca bulgu alır
    expect(computeScore.length).toBe(1);
  });
});
