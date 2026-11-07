import { LLMReportSchema, type Finding, type LLMReport, type MatchTier, type VerifiedFinding } from "./schema";
import { SEVERITY_RANK, type Severity } from "./categories";
import { normalizeForMatch, normalizeWithMap, caseFold, wordCount, type NormalizedWithMap } from "./normalize";
import type { Segment } from "./segment";

export type RejectReason =
  | "quote_has_forbidden_token"
  | "quote_too_short"
  | "quote_not_found"
  | "quote_from_flagged_segment";

export const REJECT_REASON_TR: Record<RejectReason, string> = {
  quote_has_forbidden_token: "Alıntı yasaklı işaret içeriyor (üç nokta, segment etiketi veya ayraç)",
  quote_too_short: "Alıntı çok kısa",
  quote_not_found: "Alıntı orijinal metinde birebir bulunamadı",
  quote_from_flagged_segment: "Alıntı, talimat içerdiği için işaretlenen bir bölümden geliyor",
};

export interface RejectedFinding {
  finding: Finding;
  reason: RejectReason;
  closestMatchPreview: string | null;
}

export type FailureCode = "canary_leak" | "json_parse" | "schema_invalid";

export type ParseResult =
  | { ok: true; report: LLMReport }
  | { ok: false; failure: FailureCode; errors: string };

export interface VerifiedFindingInternal extends VerifiedFinding {
  /** canonicalText içindeki [start, end) aralığı (V8 ve eval için) */
  canonicalSpan: { start: number; end: number };
}

export interface ChunkVerification {
  report: LLMReport;
  verified: VerifiedFindingInternal[];
  manipulative: VerifiedFindingInternal[];
  rejected: RejectedFinding[];
  proposedCount: number;
  corrections: string[];
  /** V11: bu chunk'ta heuristik flag var ama LLM injection_suspected=false */
  modelPossiblyInfluenced: boolean;
}

// ---------- V0 ----------
export function hasCanaryLeak(raw: string, canary: string): boolean {
  if (!canary) return false;
  if (raw.includes(canary)) return true;
  // parçalı sızıntı: canary'nin hex kısmı
  const hex = canary.replace(/^CANARY-/, "");
  return hex.length >= 8 && raw.includes(hex);
}

// ---------- V1 + V2 ----------
export function stripCodeFence(raw: string): string {
  let t = raw.trim();
  const m = /^```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(t);
  if (m) t = m[1]!.trim();
  return t;
}

export function parseLLMOutput(raw: string, canary: string): ParseResult {
  if (hasCanaryLeak(raw, canary)) return { ok: false, failure: "canary_leak", errors: "canary leaked" };
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(raw));
  } catch (e) {
    return { ok: false, failure: "json_parse", errors: `Invalid JSON: ${(e as Error).message}`.slice(0, 300) };
  }
  const parsed = LLMReportSchema.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .slice(0, 20)
      .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return { ok: false, failure: "schema_invalid", errors };
  }
  return { ok: true, report: parsed.data };
}

// ---------- V3 / V4 ----------
const FORBIDDEN_RE = /(\.\.\.|…|\[S\d+|<<<|>>>)/;
export function hasForbiddenToken(quote: string): boolean {
  return FORBIDDEN_RE.test(quote);
}
export function isQuoteTooShort(quote: string): boolean {
  const n = normalizeForMatch(quote);
  return n.length < 25 || wordCount(n) < 5;
}

// ---------- V5 ----------
export interface SegmentIndex {
  segments: Segment[];
  byId: Map<string, Segment>;
  norm: Map<string, NormalizedWithMap>;
  folded: Map<string, string>;
  lang: string | null;
}

export function buildSegmentIndex(segments: Segment[], lang: string | null): SegmentIndex {
  const byId = new Map<string, Segment>();
  const norm = new Map<string, NormalizedWithMap>();
  const folded = new Map<string, string>();
  for (const s of segments) {
    byId.set(s.id, s);
    const nm = normalizeWithMap(s.text);
    norm.set(s.id, nm);
    folded.set(s.id, caseFold(nm.text, lang));
  }
  return { segments, byId, norm, folded, lang };
}

export interface QuoteLocation {
  segment: Segment;
  tier: MatchTier;
  corrected: boolean;
  /** segment.text içindeki aralık */
  start: number;
  end: number;
}

function matchInSegment(quote: string, s: Segment, idx: SegmentIndex): { tier: MatchTier; start: number; end: number } | null {
  const exact = s.text.indexOf(quote);
  if (exact >= 0) return { tier: "exact", start: exact, end: exact + quote.length };
  const nm = idx.norm.get(s.id)!;
  const nq = normalizeForMatch(quote);
  if (!nq) return null;
  const ni = nm.text.indexOf(nq);
  if (ni >= 0) return { tier: "normalized", start: nm.map[ni]!, end: nm.mapEnd[ni + nq.length - 1]! };
  const fs = idx.folded.get(s.id)!;
  const fq = caseFold(nq, idx.lang);
  const fi = fs.indexOf(fq);
  if (fi >= 0) {
    // katlama uzunluğu değiştirmediyse normalize haritasını kullan, aksi halde segmentin tamamı
    if (fs.length === nm.text.length && fq.length === nq.length)
      return { tier: "case_insensitive", start: nm.map[fi]!, end: nm.mapEnd[fi + fq.length - 1]! };
    return { tier: "case_insensitive", start: 0, end: s.text.length };
  }
  return null;
}

/** Fuzzy eşleşme YOKTUR: yalnızca exact / normalized / case_insensitive. */
export function locateQuote(quote: string, claimedId: string, idx: SegmentIndex): QuoteLocation | null {
  const claimed = idx.byId.get(claimedId);
  if (claimed) {
    const m = matchInSegment(quote, claimed, idx);
    if (m) return { segment: claimed, corrected: false, ...m };
  }
  for (const s of idx.segments) {
    if (s.id === claimedId) continue;
    const m = matchInSegment(quote, s, idx);
    if (m) return { segment: s, corrected: true, ...m };
  }
  return null;
}

/** Debug: alıntı ile en uzun ortak alt dizeyi içeren segment parçası (en fazla 80 karakter). */
export function closestMatchPreview(quote: string, idx: SegmentIndex): string | null {
  const q = normalizeForMatch(quote);
  let best = "";
  for (const s of idx.segments) {
    const t = idx.norm.get(s.id)!.text;
    const lcs = longestCommonSubstring(q, t);
    if (lcs.length > best.length) best = lcs;
  }
  if (best.length < 8) return null;
  return best.slice(0, 80);
}

export function longestCommonSubstring(a: string, b: string): string {
  if (!a || !b) return "";
  const A = a.slice(0, 600);
  const B = b.slice(0, 4000);
  let prev = new Uint16Array(B.length + 1);
  let cur = new Uint16Array(B.length + 1);
  let best = 0;
  let endA = 0;
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      if (A.charCodeAt(i - 1) === B.charCodeAt(j - 1)) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) {
          best = cur[j]!;
          endA = i;
        }
      } else cur[j] = 0;
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return A.slice(endA - best, endA);
}

// ---------- V9 ----------
const TR_CHARS = /[çğıöşüİÇĞÖŞÜ]/;
const TR_STOPWORDS = new Set(["ve", "bir", "bu", "için", "ile", "olarak", "veya", "de", "da"]);
export function looksTurkish(s: string): boolean {
  if (TR_CHARS.test(s)) return true;
  const words = s.toLocaleLowerCase("tr").split(/[^\p{L}]+/u);
  return words.filter((w) => TR_STOPWORDS.has(w)).length >= 2;
}

// ---------- V10 ----------
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
export function cleanOutputText(s: string): string {
  return s
    .replace(URL_RE, "")
    .replace(/[<>]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ---------- V7 ----------
function atLeastHigh(s: Severity): Severity {
  return SEVERITY_RANK[s] >= SEVERITY_RANK.high ? s : "high";
}

export interface VerifyContext {
  index: SegmentIndex;
  flagged: Set<string>;
  idPrefix?: string;
}

/** V3–V10 (+V11) — Zod'dan geçmiş bir rapordaki bulguları doğrular. */
export function verifyReport(report: LLMReport, ctx: VerifyContext): ChunkVerification {
  const verified: VerifiedFindingInternal[] = [];
  const manipulative: VerifiedFindingInternal[] = [];
  const rejected: RejectedFinding[] = [];
  const corrections: string[] = [];

  report.findings.forEach((f, i) => {
    if (hasForbiddenToken(f.quote)) {
      rejected.push({ finding: f, reason: "quote_has_forbidden_token", closestMatchPreview: null });
      return;
    }
    if (isQuoteTooShort(f.quote)) {
      rejected.push({ finding: f, reason: "quote_too_short", closestMatchPreview: null });
      return;
    }
    const loc = locateQuote(f.quote, f.segment_id, ctx.index);
    if (!loc) {
      rejected.push({ finding: f, reason: "quote_not_found", closestMatchPreview: closestMatchPreview(f.quote, ctx.index) });
      return;
    }
    const isManip = f.category === "manipulative_content";
    if (ctx.flagged.has(loc.segment.id) && !isManip) {
      rejected.push({ finding: f, reason: "quote_from_flagged_segment", closestMatchPreview: null });
      return;
    }
    if (loc.corrected) corrections.push(`V5: segment_id ${f.segment_id} → ${loc.segment.id}`);
    let severity = f.severity;
    if (isManip && atLeastHigh(severity) !== severity) {
      corrections.push(`V7: manipulative_content severity ${severity} → high`);
      severity = "high";
    }
    const title_tr = cleanOutputText(f.title_tr);
    const explanation_tr = cleanOutputText(f.explanation_tr);
    const vf: VerifiedFindingInternal = {
      ...f,
      severity,
      title_tr,
      explanation_tr,
      // UI'da her zaman kaynak metindeki karşılık gösterilir (LLM'in yazdığı değil)
      quote: loc.segment.text.slice(loc.start, loc.end),
      segment_id: loc.segment.id,
      id: `${ctx.idPrefix ?? "F"}${i + 1}`,
      matchTier: loc.tier,
      segmentCorrected: loc.corrected,
      languageWarning: !looksTurkish(`${title_tr} ${explanation_tr}`),
      headingPath: [...loc.segment.headingPath],
      canonicalSpan: { start: loc.segment.charStart + loc.start, end: loc.segment.charStart + loc.end },
    };
    (isManip ? manipulative : verified).push(vf);
  });

  const chunkHasFlag = ctx.index.segments.some((s) => ctx.flagged.has(s.id));
  return {
    report: {
      ...report,
      summary_tr: cleanOutputText(report.summary_tr),
      uncertainty_notes_tr: report.uncertainty_notes_tr === null ? null : cleanOutputText(report.uncertainty_notes_tr),
    },
    verified,
    manipulative,
    rejected,
    proposedCount: report.findings.length,
    corrections,
    modelPossiblyInfluenced: chunkHasFlag && !report.injection_suspected,
  };
}

// ---------- V8 ----------
function overlapRatio(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? inter / shorter : 0;
}

function better(a: VerifiedFindingInternal, b: VerifiedFindingInternal): VerifiedFindingInternal {
  if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] > SEVERITY_RANK[b.severity] ? a : b;
  return a.confidence >= b.confidence ? a : b;
}

/** Aynı normalize alıntı veya aynı segmentte %80+ çakışan aralık → tek bulgu (yüksek severity kalır). */
export function dedupeFindings(list: VerifiedFindingInternal[]): { findings: VerifiedFindingInternal[]; merged: number } {
  const out: VerifiedFindingInternal[] = [];
  let merged = 0;
  for (const f of list) {
    const key = caseFold(normalizeForMatch(f.quote), null);
    const j = out.findIndex(
      (g) =>
        caseFold(normalizeForMatch(g.quote), null) === key ||
        (g.segment_id === f.segment_id && overlapRatio(g.canonicalSpan, f.canonicalSpan) >= 0.8),
    );
    if (j >= 0) {
      out[j] = better(out[j]!, f);
      merged++;
    } else out.push(f);
  }
  return { findings: out, merged };
}

export function sortFindings<T extends VerifiedFinding>(list: T[]): T[] {
  return [...list].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence);
}

// ---------- V12 ----------
export const SCORE_DIVERGENCE_THRESHOLD = 30;
export function isScoreDivergent(llmScore: number | null, deterministic: number): boolean {
  return llmScore !== null && Math.abs(llmScore - deterministic) >= SCORE_DIVERGENCE_THRESHOLD;
}
