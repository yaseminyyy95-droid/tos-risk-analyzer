import type { RiskCategory } from "./categories";
import type { SentinelHint } from "./schema";
import type { Segment } from "./segment";

export const SENTINEL_RULES: { category: RiskCategory; re: RegExp }[] = [
  { category: "arbitration_class_waiver", re: /\b(arbitration|class action|waive[^.]{0,60}\bjury)/i },
  { category: "auto_renewal", re: /\b(automatically renew\w*|auto-renew\w*)|otomatik (olarak )?yenilen/i },
  { category: "data_sale_or_sharing", re: /\bsell (your )?personal (data|information)|verilerinizi sat/i },
  { category: "ai_training_use", re: /\btrain(ing)? (our )?(ai|models|machine learning)/i },
  { category: "sensitive_biometric_data", re: /\b(biometric|faceprint|voiceprint)/i },
  { category: "cancellation_refund", re: /\b(non-refundable|no refunds)|iade edilmez/i },
  { category: "content_license_ip", re: /\b(perpetual|irrevocable[^.]{0,80}license)/i },
  { category: "unilateral_changes", re: /\bwithout (prior )?notice/i },
];

/**
 * Deterministik anahtar kelime çapraz kontrolü: anahtar kelime geçiyor ama o kategoride
 * doğrulanmış bulgu yoksa ipucu üretir. Skoru ETKİLEMEZ.
 */
export function findSentinelHints(segments: Segment[], verifiedCategories: Set<string>, flagged: Set<string>): SentinelHint[] {
  const hints: SentinelHint[] = [];
  const seen = new Set<string>();
  for (const rule of SENTINEL_RULES) {
    if (verifiedCategories.has(rule.category) || seen.has(rule.category)) continue;
    for (const s of segments) {
      if (flagged.has(s.id)) continue;
      const m = rule.re.exec(s.text);
      if (!m) continue;
      const from = Math.max(0, m.index - 50);
      const to = Math.min(s.text.length, m.index + m[0].length + 70);
      const snippet = (from > 0 ? "…" : "") + s.text.slice(from, to).trim() + (to < s.text.length ? "…" : "");
      hints.push({ category: rule.category, matchedText: snippet, segmentId: s.id });
      seen.add(rule.category);
      break;
    }
  }
  return hints;
}
