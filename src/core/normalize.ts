// Alıntı eşleme için metin normalizasyonu. Büyük/küçük harf KORUNUR.

/** Silinecek görünmez / biçimlendirme / bidi kontrol karakterleri. */
export const INVISIBLE_CHARS_RE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const INVISIBLE_ONE = /^[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]$/;

const CHAR_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "′": "'",
  "´": "'",
  "`": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "−": "-",
  "…": "...",
};

const WS = /^\s$/u;
const COMBINING = /^\p{M}$/u;

export interface NormalizedWithMap {
  text: string;
  /** map[i] = normalize edilmiş metindeki i. UTF-16 birimin orijinal metindeki başlangıç indeksi */
  map: number[];
  /** mapEnd[i] = o birimi üreten orijinal kümenin bitiş indeksi (hariç) */
  mapEnd: number[];
}

/**
 * Tek geçişte normalize eder ve indeks haritası üretir. Taban karakter + birleşik işaretler
 * (ör. "e" + U+0301) birlikte NFKC'ye sokulur; böylece birleşik/ayrık yazımlar aynı sonuca iner.
 */
export function normalizeWithMap(original: string): NormalizedWithMap {
  const out: string[] = [];
  const map: number[] = [];
  const mapEnd: number[] = [];
  let pendingSpace = -1; // bekleyen boşluğun orijinal indeksi
  let pendingSpaceEnd = -1;

  const pushChars = (s: string, start: number, end: number) => {
    for (let k = 0; k < s.length; k++) {
      out.push(s[k]!);
      map.push(start);
      mapEnd.push(end);
    }
  };

  let i = 0;
  while (i < original.length) {
    const start = i;
    const cp = original.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    // birleşik işaretleri kümeye ekle
    while (i < original.length) {
      const next = original.codePointAt(i)!;
      const ch = String.fromCodePoint(next);
      if (!COMBINING.test(ch)) break;
      i += next > 0xffff ? 2 : 1;
    }
    const cluster = original.slice(start, i);
    // önce eşleme (NFKC ´ karakterini boşluk + birleşik aksana açar), sonra NFKC, sonra tekrar eşleme
    let pre = "";
    for (const ch of cluster) pre += CHAR_MAP[ch] ?? ch;
    let norm = pre.normalize("NFKC");
    norm = norm.replace(INVISIBLE_CHARS_RE, "");
    let mapped = "";
    for (const ch of norm) mapped += CHAR_MAP[ch] ?? ch;
    if (mapped.length === 0) continue;

    // boşluk sıkıştırma (NFKC NBSP'yi zaten boşluğa çevirir)
    let buf = "";
    for (const ch of mapped) {
      if (WS.test(ch)) {
        if (buf) {
          flushPending();
          pushChars(buf, start, i);
          buf = "";
        }
        if (pendingSpace < 0) {
          pendingSpace = start;
          pendingSpaceEnd = i;
        } else pendingSpaceEnd = i;
      } else buf += ch;
    }
    if (buf) {
      flushPending();
      pushChars(buf, start, i);
    }
  }

  function flushPending() {
    if (pendingSpace >= 0) {
      if (out.length > 0) {
        out.push(" ");
        map.push(pendingSpace);
        mapEnd.push(pendingSpaceEnd);
      }
      pendingSpace = -1;
    }
  }
  // sondaki boşluk atılır (trim)
  return { text: out.join(""), map, mapEnd };
}

export function normalizeForMatch(s: string): string {
  return normalizeWithMap(s).text;
}

/** buildIndexMap(original)[i] = normalize edilmiş metnin i. karakterinin orijinaldeki indeksi */
export function buildIndexMap(original: string): number[] {
  return normalizeWithMap(original).map;
}

/** Normalize edilmiş metindeki [nStart, nEnd) aralığını orijinal metindeki aralığa çevirir. */
export function mapRangeToOriginal(
  nm: NormalizedWithMap,
  nStart: number,
  nEnd: number,
): { start: number; end: number } | null {
  if (nStart < 0 || nEnd > nm.text.length || nStart >= nEnd) return null;
  return { start: nm.map[nStart]!, end: nm.mapEnd[nEnd - 1]! };
}

export function isInvisibleChar(ch: string): boolean {
  return INVISIBLE_ONE.test(ch);
}

export function caseFold(s: string, lang: string | null): string {
  return s.toLocaleLowerCase(lang?.toLowerCase().startsWith("tr") ? "tr" : "en");
}

export function wordCount(s: string): number {
  return s.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
