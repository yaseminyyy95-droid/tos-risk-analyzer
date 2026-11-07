import type { ExtractedBlock } from "./types";

export interface Segment {
  id: string;
  text: string;
  headingPath: string[];
  charStart: number;
  charEnd: number;
}

export interface SegmentationResult {
  segments: Segment[];
  canonicalText: string;
  truncated: boolean;
}

export interface Chunk {
  index: number;
  segments: Segment[];
  /** Önceki chunk'ın son başlık yolu (bağlam için) */
  contextHeadingPath: string[] | null;
  chars: number;
}

export const SEGMENT_MIN = 400;
export const SEGMENT_MAX = 1200;
export const MAX_TOTAL_CHARS = 200_000;
export const SEGMENT_SEPARATOR = "\n\n";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function formatSegmentId(n: number): string {
  return "S" + String(n).padStart(n >= 1000 ? 4 : 3, "0");
}

/** Uzun bir paragrafı cümle sınırlarından SEGMENT_MAX'ı aşmayacak parçalara böler. */
export function splitLongText(text: string, max = SEGMENT_MAX): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?;:]+(?:[.!?;:]+["')\]]*\s*|$)/gu) ?? [text];
  const parts: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) {
      parts.push(cur.trim());
      cur = "";
    }
    if (s.length > max) {
      // cümle tek başına çok uzun: kelime sınırından böl
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(" ", max);
        if (cut < max / 2) cut = max;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut);
      }
      cur = rest;
    } else cur += s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

export interface SegmentOptions {
  /** true dönen bloklar tek başına segment olur (ör. injection şüphesi) — masum metinle karışmasın */
  isolate?: (text: string) => boolean;
  maxTotalChars?: number;
}

/**
 * Bloklardan [S001].. segmentleri üretir. Paragraflar bölünmez (çok uzunsa cümle sınırından bölünür);
 * küçük bloklar SEGMENT_MIN'e ulaşana kadar birleştirilir; başlıklar yeni segment başlatır.
 */
export function segmentBlocks(blocks: ExtractedBlock[], opts: SegmentOptions = {}): SegmentationResult {
  const maxTotal = opts.maxTotalChars ?? MAX_TOTAL_CHARS;
  type Draft = { parts: string[]; headingPath: string[]; onlyHeadings: boolean; isolated: boolean };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  const len = (d: Draft) => d.parts.reduce((a, p) => a + p.length + 1, -1);

  for (const b of blocks) {
    const text = b.text.trim();
    if (!text) continue;
    const isHeading = HEADING_TAGS.has(b.tag);
    const isolated = !isHeading && (opts.isolate?.(text) ?? false);
    for (const piece of isolated ? [text] : splitLongText(text)) {
      const mustStartNew =
        !cur ||
        isolated ||
        cur.isolated ||
        (isHeading && !cur.onlyHeadings) ||
        (!cur.onlyHeadings && len(cur) >= SEGMENT_MIN) ||
        len(cur) + 1 + piece.length > SEGMENT_MAX;
      if (mustStartNew) {
        cur = { parts: [piece], headingPath: b.headingPath, onlyHeadings: isHeading, isolated };
        drafts.push(cur);
      } else {
        cur!.parts.push(piece);
        if (cur!.onlyHeadings && !isHeading) {
          cur!.headingPath = b.headingPath;
          cur!.onlyHeadings = false;
        }
      }
    }
  }

  const segments: Segment[] = [];
  let offset = 0;
  let truncated = false;
  for (const d of drafts) {
    const text = d.parts.join("\n");
    const start = segments.length === 0 ? 0 : offset + SEGMENT_SEPARATOR.length;
    if (start + text.length > maxTotal) {
      truncated = true;
      break;
    }
    segments.push({
      id: formatSegmentId(segments.length + 1),
      text,
      headingPath: [...d.headingPath],
      charStart: start,
      charEnd: start + text.length,
    });
    offset = start + text.length;
  }
  const canonicalText = segments.map((s) => s.text).join(SEGMENT_SEPARATOR);
  return { segments, canonicalText, truncated };
}

/** Segment sınırında chunk'lara böler. */
export function chunkSegments(segments: Segment[], maxCharsPerChunk = 40_000): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Segment[] = [];
  let chars = 0;
  const flush = () => {
    if (!cur.length) return;
    const prev = chunks[chunks.length - 1];
    const prevLast = prev?.segments[prev.segments.length - 1];
    chunks.push({
      index: chunks.length,
      segments: cur,
      contextHeadingPath: prevLast ? [...prevLast.headingPath] : null,
      chars,
    });
    cur = [];
    chars = 0;
  };
  for (const s of segments) {
    if (cur.length && chars + s.text.length > maxCharsPerChunk) flush();
    cur.push(s);
    chars += s.text.length + SEGMENT_SEPARATOR.length;
  }
  flush();
  return chunks;
}
