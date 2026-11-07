import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { RISK_CATEGORIES, SEVERITIES } from "./categories";

export const SEGMENT_ID_RE = /^S\d{3,4}$/;

export const DOCUMENT_TYPES = [
  "terms_of_service",
  "privacy_policy",
  "subscription_terms",
  "cookie_policy",
  "mixed_legal",
  "not_legal_document",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const FindingSchema = z
  .object({
    category: z.enum(RISK_CATEGORIES),
    severity: z.enum(SEVERITIES),
    title_tr: z.string().min(5).max(90),
    explanation_tr: z.string().min(20).max(450),
    quote: z.string().min(25).max(500),
    segment_id: z.string().regex(SEGMENT_ID_RE),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const LLMReportSchema = z
  .object({
    schema_version: z.literal("1.0"),
    document_type: z.enum(DOCUMENT_TYPES),
    document_language: z.string().min(2).max(10),
    llm_suggested_score: z.number().int().min(0).max(100),
    summary_tr: z.string().min(20).max(700),
    findings: z.array(FindingSchema).max(25),
    injection_suspected: z.boolean(),
    injection_segment_ids: z.array(z.string().regex(SEGMENT_ID_RE)).max(50),
    uncertainty_notes_tr: z.string().max(500).nullable(),
  })
  .strict();

export type Finding = z.infer<typeof FindingSchema>;
export type LLMReport = z.infer<typeof LLMReportSchema>;

export const LLM_REPORT_JSON_SCHEMA = zodToJsonSchema(LLMReportSchema, {
  $refStrategy: "none",
  target: "openAi",
}) as Record<string, unknown>;

/** OpenAI/Anthropic'e gönderilen şema ($schema meta alanı olmadan). */
export function llmJsonSchema(): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { $schema, ...rest } = LLM_REPORT_JSON_SCHEMA as Record<string, unknown> & { $schema?: unknown };
  return rest;
}

// ---------- UI'ya giden nihai yapı ----------

export const DISCLAIMER_TR =
  "Bu uygulama hukuki tavsiye vermez. Sonuçlar otomatik üretilmiştir ve hatalı veya eksik olabilir; önemli kararlar için bir hukuk profesyoneline danışın." as const;

export type MatchTier = "exact" | "normalized" | "case_insensitive";
export type ReportStatus = "OK" | "PARTIAL" | "UNCERTAIN" | "FAILED";
export type RiskLevel = "Düşük" | "Orta" | "Yüksek" | "Kritik";

export interface VerifiedFinding extends Finding {
  id: string;
  matchTier: MatchTier;
  segmentCorrected: boolean;
  languageWarning: boolean;
  headingPath: string[];
}

export interface SentinelHint {
  category: Finding["category"];
  matchedText: string;
  segmentId: string;
}

export interface VerifiedReport {
  reportId: string;
  createdAt: string;
  url: string;
  host: string;
  title: string;
  promptVersion: string;
  provider: string;
  model: string;
  textSha256: string;
  durationMs: number;
  status: ReportStatus;
  statusReasons_tr: string[];
  score: number;
  level: RiskLevel;
  llmSuggestedScore: number | null;
  documentType: string;
  legalPageConfidence: number;
  summary_tr: string;
  findings: VerifiedFinding[];
  manipulativeFindings: VerifiedFinding[];
  rejectedCount: number;
  rejectedReasons: Record<string, number>;
  /** Yalnızca geliştirici modunda gösterilir; bulgu metni içermez. */
  rejectedDetails: { reason: string; category: string; closestMatchPreview: string | null }[];
  proposedCount: number;
  groundingRate: number;
  injection: {
    heuristicFlaggedSegments: string[];
    flaggedPreviews: string[];
    llmSuspected: boolean;
    hiddenBlocksRemoved: number;
    hiddenBlocksWithInstructions: number;
    modelPossiblyInfluenced: boolean;
  };
  sentinelHints: SentinelHint[];
  coverage: { segments: number; chunks: number; truncated: boolean; visibleChars: number };
  uncertaintyNotes_tr: string | null;
  disclaimer_tr: typeof DISCLAIMER_TR;
}
