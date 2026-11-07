import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  buildIndexMap,
  normalizeWithMap,
  mapRangeToOriginal,
  caseFold,
  wordCount,
} from "../../src/core/normalize";

describe("normalizeForMatch", () => {
  it("tipografik tırnakları ve tireleri birleştirir", () => {
    expect(normalizeForMatch("“Acme” isn’t – really — fine")).toBe(`"Acme" isn't - really - fine`);
    expect(normalizeForMatch("«x» ‚y‘ `z´")).toBe(`"x" 'y' 'z'`);
  });
  it("üç nokta karakterini ... yapar", () => {
    expect(normalizeForMatch("wait…")).toBe("wait...");
  });
  it("NBSP, CRLF ve boşluk dizilerini tek boşluğa indirir ve trim eder", () => {
    expect(normalizeForMatch("  a\u00A0\u00A0b\r\n\r\nc\t d  ")).toBe("a b c d");
  });
  it("soft hyphen, sıfır genişlik ve bidi karakterlerini siler", () => {
    expect(normalizeForMatch("arbi\u00ADtra\u200Btion\u202E \u2066x\u2069\uFEFF")).toBe("arbitration x");
  });
  it("büyük/küçük harfi korur, Türkçe İ/ı bozulmaz", () => {
    expect(normalizeForMatch("İPTAL ıslak Işık")).toBe("İPTAL ıslak Işık");
  });
  it("birleşik ve ayrık aksanları eşitler", () => {
    expect(normalizeForMatch("café")).toBe(normalizeForMatch("café"));
  });
  it("NFKC tam genişlik karakterleri dönüştürür", () => {
    expect(normalizeForMatch("ＡＢＣ１")).toBe("ABC1");
  });
});

describe("buildIndexMap", () => {
  it("emoji içeren metinde indeksleri doğru eşler", () => {
    const orig = "ok 😀  then";
    const nm = normalizeWithMap(orig);
    expect(nm.text).toBe("ok 😀 then");
    const map = buildIndexMap(orig);
    expect(map.length).toBe(nm.text.length);
    const tIdx = nm.text.indexOf("then");
    expect(orig.slice(map[tIdx])).toBe("then");
  });
  it("soft hyphen ve NBSP sonrası aralık orijinale doğru eşlenir", () => {
    const orig = "We may sell\u00A0your per\u00ADsonal data.";
    const nm = normalizeWithMap(orig);
    const q = "your personal data";
    const s = nm.text.indexOf(q);
    const r = mapRangeToOriginal(nm, s, s + q.length)!;
    expect(orig.slice(r.start, r.end)).toBe("your per\u00ADsonal data");
  });
  it("CRLF ve baştaki boşlukları atlar", () => {
    const orig = "\r\n  Hello\r\nWorld";
    const nm = normalizeWithMap(orig);
    expect(nm.text).toBe("Hello World");
    expect(orig[nm.map[0]!]).toBe("H");
    expect(orig[nm.map[6]!]).toBe("W");
  });
  it("tek karakterin çok karaktere açıldığı durumda (…) aynı orijinal indeksi verir", () => {
    const nm = normalizeWithMap("a…b");
    expect(nm.text).toBe("a...b");
    expect(nm.map).toEqual([0, 1, 1, 1, 2]);
  });
  it("geçersiz aralık null döner", () => {
    expect(mapRangeToOriginal(normalizeWithMap("abc"), 2, 1)).toBeNull();
  });
});

describe("yardımcılar", () => {
  it("caseFold Türkçe yerelini kullanır", () => {
    expect(caseFold("İPTAL", "tr")).toBe("iptal");
    expect(caseFold("TITLE", "en")).toBe("title");
  });
  it("wordCount noktalama işaretlerini kelime saymaz", () => {
    expect(wordCount("We - may sell , data")).toBe(4);
  });
});
