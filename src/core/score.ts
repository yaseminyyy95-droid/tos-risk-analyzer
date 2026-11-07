import type { RiskLevel } from "./schema";
import type { Severity } from "./categories";
import { SEVERITY_RANK } from "./categories";

export const SEVERITY_WEIGHTS: Record<Severity, number> = { critical: 35, high: 20, medium: 9, low: 3 };
export const MAX_PER_CATEGORY = 2;
export const LOW_CONFIDENCE = 0.4;

export interface ScorableFinding {
  category: string;
  severity: Severity;
  confidence: number;
}

/**
 * Deterministik skor: yalnızca doğrulanmış bulgulardan. LLM'in önerdiği skor KULLANILMAZ.
 * score = round(100 * (1 - Π (1 - w_i/100)))
 */
export function computeScore(findings: ScorableFinding[]): number {
  const byCat = new Map<string, ScorableFinding[]>();
  for (const f of findings) {
    if (f.category === "manipulative_content") continue;
    const arr = byCat.get(f.category) ?? [];
    arr.push(f);
    byCat.set(f.category, arr);
  }
  let keep = 1;
  for (const arr of byCat.values()) {
    const weights = arr
      .map((f) => SEVERITY_WEIGHTS[f.severity] * (f.confidence < LOW_CONFIDENCE ? 0.5 : 1))
      .sort((a, b) => b - a)
      .slice(0, MAX_PER_CATEGORY);
    for (const w of weights) keep *= 1 - w / 100;
  }
  return Math.round(100 * (1 - keep));
}

export function scoreLevel(score: number): RiskLevel {
  if (score >= 75) return "Kritik";
  if (score >= 50) return "Yüksek";
  if (score >= 25) return "Orta";
  return "Düşük";
}

export { SEVERITY_RANK };
