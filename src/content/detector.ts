// "Bu sayfa hukuki metin mi?" heuristiği → 0..1 güven.

const URL_RE = /(terms|tos|legal|privacy|gizlilik|kosullar|koşullar|sozlesme|sözleşme|kvkk|subscription|agreement|policy|eula|aydinlatma)/i;
const TITLE_RE = /(terms|conditions|privacy|policy|legal|agreement|subscription|cookie|kullanım koşulları|gizlilik|sözleşme|kvkk|aydınlatma|çerez)/i;

export const LEGAL_KEYWORDS = [
  "governing law",
  "arbitration",
  "personal data",
  "personal information",
  "liability",
  "indemnify",
  "warranty",
  "terminate",
  "jurisdiction",
  "third parties",
  "privacy",
  "subscription",
  "refund",
  "license",
  "these terms",
  "you agree",
  "kişisel veri",
  "yürürlük",
  "sözleşme",
  "taraflar",
  "sorumluluk",
  "fesih",
  "uyuşmazlık",
  "gizlilik",
  "veri sorumlusu",
  "açık rıza",
];

export interface DetectorInput {
  url: string;
  title: string;
  h1: string;
  text: string;
}

export function legalPageConfidence(input: DetectorInput): number {
  let score = 0;
  let path = input.url;
  try {
    const u = new URL(input.url);
    path = u.pathname + u.search;
  } catch {
    /* ham değer */
  }
  if (URL_RE.test(path)) score += 0.3;
  if (TITLE_RE.test(input.title)) score += 0.2;
  if (TITLE_RE.test(input.h1)) score += 0.15;
  const text = input.text.slice(0, 60_000).toLocaleLowerCase("en");
  const distinct = LEGAL_KEYWORDS.filter((k) => text.includes(k)).length;
  score += Math.min(0.45, distinct * 0.05);
  if (input.text.length < 800) score *= 0.6;
  return Math.round(Math.min(1, score) * 100) / 100;
}
