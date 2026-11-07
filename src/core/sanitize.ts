import { INVISIBLE_CHARS_RE } from "./normalize";
import type { ExtractedBlock } from "./types";

export interface SanitizationReport {
  removedInvisible: number;
  removedControl: number;
  neutralizedDelimiters: number;
  neutralizedSegmentLabels: number;
  roleLinesMarked: number;
}

export const ROLE_MARK = "⟦quoted⟧";

export function emptySanitizationReport(): SanitizationReport {
  return { removedInvisible: 0, removedControl: 0, neutralizedDelimiters: 0, neutralizedSegmentLabels: 0, roleLinesMarked: 0 };
}

// \n (U+000A) ve \t (U+0009) korunur; diğer C0 kontrol karakterleri + DEL silinir.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const ROLE_LINE_RE = /^([ \t]*)(system|assistant|user|developer)([ \t]*):/gim;

/**
 * LLM'e gidecek metni temizler. canonicalText bu fonksiyonun çıktısıdır; böylece doğrulama
 * ile LLM'in gördüğü metin birebir aynıdır.
 */
export function sanitizeText(input: string, report: SanitizationReport = emptySanitizationReport()): { text: string; report: SanitizationReport } {
  let t = input;
  t = t.replace(INVISIBLE_CHARS_RE, () => {
    report.removedInvisible++;
    return "";
  });
  t = t.replace(CONTROL_RE, () => {
    report.removedControl++;
    return "";
  });
  t = t.replace(/<<</g, () => {
    report.neutralizedDelimiters++;
    return "‹‹‹";
  });
  t = t.replace(/>>>/g, () => {
    report.neutralizedDelimiters++;
    return "›››";
  });
  t = t.replace(/\[S(?=\d)/g, () => {
    report.neutralizedSegmentLabels++;
    return "[S·";
  });
  t = t.replace(ROLE_LINE_RE, (_m, ws: string, role: string, ws2: string) => {
    report.roleLinesMarked++;
    return `${ws}${ROLE_MARK} ${role}${ws2}:`;
  });
  return { text: t, report };
}

export function sanitizeBlocks(blocks: ExtractedBlock[]): { blocks: ExtractedBlock[]; report: SanitizationReport } {
  const report = emptySanitizationReport();
  const out: ExtractedBlock[] = [];
  for (const b of blocks) {
    if (b.visibility === "adversarial_hidden") continue; // savunma: extractor zaten ayırır
    const text = sanitizeText(b.text, report).text.trim();
    if (!text) continue;
    out.push({ ...b, text, headingPath: b.headingPath.map((h) => sanitizeText(h, report).text) });
  }
  return { blocks: out, report };
}
