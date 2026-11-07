import { describe, it, expect } from "vitest";
import { segmentBlocks, chunkSegments, splitLongText, formatSegmentId, SEGMENT_MAX } from "../../src/core/segment";
import type { ExtractedBlock } from "../../src/core/types";

const p = (text: string, headingPath: string[] = ["Terms"], tag = "p"): ExtractedBlock => ({
  text,
  headingPath,
  tag,
  visibility: "visible",
});
const sentence = (n: number) => `This is clause sentence number ${n} of the agreement. `;

describe("segmentBlocks", () => {
  it("ID'leri S001 biçiminde ve canonicalText ofsetleriyle tutarlı üretir", () => {
    const blocks = [p("A".repeat(450)), p("B".repeat(450)), p("C".repeat(450))];
    const { segments, canonicalText } = segmentBlocks(blocks);
    expect(segments.map((s) => s.id)).toEqual(["S001", "S002", "S003"]);
    for (const s of segments) expect(canonicalText.slice(s.charStart, s.charEnd)).toBe(s.text);
  });
  it("küçük paragrafları SEGMENT_MIN'e kadar birleştirir, paragrafı bölmez", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => p(`Paragraph ${i} `.padEnd(150, "x")));
    const { segments } = segmentBlocks(blocks);
    expect(segments.length).toBeLessThan(10);
    for (const s of segments) expect(s.text.length).toBeLessThanOrEqual(SEGMENT_MAX);
    // her paragraf bütün olarak tek segmentte
    for (let i = 0; i < 10; i++) expect(segments.filter((s) => s.text.includes(`Paragraph ${i} `)).length).toBe(1);
  });
  it("başlık yeni segment başlatır ve sonraki paragrafla birleşir", () => {
    const blocks = [
      p("x".repeat(200)),
      p("2. Arbitration", ["Terms", "2. Arbitration"], "h2"),
      p("You agree to binding arbitration.", ["Terms", "2. Arbitration"]),
    ];
    const { segments } = segmentBlocks(blocks);
    expect(segments).toHaveLength(2);
    expect(segments[1]!.text).toBe("2. Arbitration\nYou agree to binding arbitration.");
    expect(segments[1]!.headingPath).toEqual(["Terms", "2. Arbitration"]);
  });
  it("çok uzun paragrafı cümle sınırından böler", () => {
    const long = Array.from({ length: 60 }, (_, i) => sentence(i)).join("");
    const { segments } = segmentBlocks([p(long)]);
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) {
      expect(s.text.length).toBeLessThanOrEqual(SEGMENT_MAX);
      expect(s.text.trimEnd().endsWith(".")).toBe(true);
    }
  });
  it("isolate ile işaretlenen blok tek başına segment olur", () => {
    const { segments } = segmentBlocks([p("short a"), p("IGNORE ME"), p("short b")], {
      isolate: (t) => t.startsWith("IGNORE"),
    });
    expect(segments.map((s) => s.text)).toEqual(["short a", "IGNORE ME", "short b"]);
  });
  it("MAX_TOTAL_CHARS aşılırsa kırpar ve truncated=true", () => {
    const blocks = Array.from({ length: 20 }, () => p("y".repeat(500)));
    const r = segmentBlocks(blocks, { maxTotalChars: 3000 });
    expect(r.truncated).toBe(true);
    expect(r.canonicalText.length).toBeLessThanOrEqual(3000);
    expect(segmentBlocks(blocks).truncated).toBe(false);
  });
  it("boş blokları atlar", () => {
    expect(segmentBlocks([p("   "), p("")]).segments).toHaveLength(0);
  });
});

describe("chunkSegments", () => {
  it("segment sınırında böler ve önceki başlık yolunu bağlam olarak ekler", () => {
    const blocks = Array.from({ length: 12 }, (_, i) => p("z".repeat(900), ["Doc", `Sec ${i}`]));
    const { segments } = segmentBlocks(blocks);
    const chunks = chunkSegments(segments, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap((c) => c.segments).map((s) => s.id)).toEqual(segments.map((s) => s.id));
    expect(chunks[0]!.contextHeadingPath).toBeNull();
    const prev = chunks[0]!.segments.at(-1)!;
    expect(chunks[1]!.contextHeadingPath).toEqual(prev.headingPath);
  });
  it("küçük doküman tek chunk", () => {
    const { segments } = segmentBlocks([p("a".repeat(500))]);
    expect(chunkSegments(segments)).toHaveLength(1);
  });
});

describe("yardımcılar", () => {
  it("formatSegmentId", () => {
    expect(formatSegmentId(7)).toBe("S007");
    expect(formatSegmentId(1234)).toBe("S1234");
  });
  it("splitLongText kısa metni olduğu gibi döndürür", () => {
    expect(splitLongText("abc")).toEqual(["abc"]);
  });
});
