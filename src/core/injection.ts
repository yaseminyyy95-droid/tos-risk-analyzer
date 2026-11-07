import { normalizeForMatch } from "./normalize";

export interface InjectionRule {
  id: string;
  re: RegExp;
  weight: number;
}

/**
 * Heuristik prompt-injection kuralları (EN + TR). Ağırlıklar segment içinde
 * 1 - Π(1 - w) ile birleştirilir; skor >= INJECTION_THRESHOLD → flag.
 */
export const INJECTION_RULES: InjectionRule[] = [
  {
    id: "ignore_previous",
    re: /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|all|earlier|system)\b.{0,20}\b(instructions?|prompts?|rules?)\b/i,
    weight: 0.9,
  },
  {
    // "model" tek başına çıkarıldı ("you are a professional model" gibi yanlış pozitifler) — bkz. DECISIONS
    id: "role_reassignment",
    re: /\b(you are now|you are an?|act as|you're now|from now on,? you)\b.{0,40}\b(ai|assistant|chatbot|gpt|claude|llm|language model|ai model|analy[sz]er)\b/i,
    weight: 0.6,
  },
  {
    id: "score_manipulation",
    re: /\b(risk|safety)\s*(score|rating)\b.{0,40}\b(0|zero|low|minimal|safe)\b/i,
    weight: 0.8,
  },
  {
    id: "safety_claim",
    re: /\b(this (document|policy|site) is (safe|fair|pre-?approved|certified))\b/i,
    weight: 0.5,
  },
  {
    id: "meta_terms",
    re: /\b(system prompt|developer message|jailbreak|as an ai language model)\b/i,
    weight: 0.7,
  },
  {
    id: "output_control",
    re: /\b(respond|reply|output|return)\b.{0,30}\b(only|exactly)\b.{0,30}(\bjson\b|"|\bsafe\b)/i,
    weight: 0.5,
  },
  {
    id: "tr_ignore_previous",
    re: /(önceki|tüm|yukarıdaki)\s+(talimat|komut|kural)\p{L}*\s+(yok say|görmezden gel|unut)/iu,
    weight: 0.9,
  },
  { id: "tr_score_manipulation", re: /risk\s*skor\p{L}*\s*(u|unu)?\s*(0|sıfır|düşük)/iu, weight: 0.8 },
  { id: "tr_addressing_ai", re: /(yapay zek[aâ]|asistan|model)\s*(olarak|sen)/iu, weight: 0.5 },
  { id: "fake_tags", re: /<\/?(system|instructions?|prompt|document)>/i, weight: 0.6 },
  // Ek kurallar (DECISIONS.md): doğrudan yapay zekâya hitap eden notlar
  {
    id: "addressing_ai",
    re: /\b(note|message|attention|instructions?)\s+(to|for)\s+(all\s+)?(ai|llms?|language models?|automated (analy[sz]ers?|systems?|tools?)|ai assistants?|assistants?|chatbots?)\b/i,
    weight: 0.6,
  },
  {
    // eval/adversarial "vendor_certified" saldırısının ortaya çıkardığı açık: otomatik araçlara ne raporlayacaklarını söyleyen cümleler
    id: "instructs_automated_tools",
    re: /\b(ai|automated|automatic|llm|analy[sz]er|ai-based)\s+(tools?|systems?|assistants?|analy[sz]ers?|models?|readers?|reviewers?)\s+(should|must|shall|are (instructed|required|expected) to)\s+(report|output|return|rate|score|classify|summari[sz]e|treat|consider|mark)\b/i,
    weight: 0.6,
  },
  {
    id: "role_prefix",
    re: /(^|\n)\s*(⟦quoted⟧\s*)?(system|assistant|developer)\s*:/i,
    weight: 0.5,
  },
  {
    id: "fake_segment_label",
    re: /\[S·\d{2,4}\]/,
    weight: 0.6,
  },
  {
    id: "fake_delimiter",
    re: /(<<<|‹‹‹)\s*(end_?)?doc/i,
    weight: 0.7,
  },
];

export const INJECTION_THRESHOLD = 0.6;

export interface InjectionScore {
  score: number;
  matchedRules: string[];
}

export function scoreInjection(text: string): InjectionScore {
  const t = normalizeForMatch(text);
  let keep = 1;
  const matchedRules: string[] = [];
  for (const r of INJECTION_RULES) {
    if (r.re.test(t)) {
      keep *= 1 - r.weight;
      matchedRules.push(r.id);
    }
  }
  return { score: Math.round((1 - keep) * 1000) / 1000, matchedRules };
}

export function isLikelyInjection(text: string): boolean {
  return scoreInjection(text).score >= INJECTION_THRESHOLD;
}

export interface SegmentLike {
  id: string;
  text: string;
}

export function scanSegments(segments: SegmentLike[]): {
  flagged: Set<string>;
  details: Record<string, InjectionScore>;
} {
  const flagged = new Set<string>();
  const details: Record<string, InjectionScore> = {};
  for (const s of segments) {
    const sc = scoreInjection(s.text);
    if (sc.score >= INJECTION_THRESHOLD) {
      flagged.add(s.id);
      details[s.id] = sc;
    }
  }
  return { flagged, details };
}
