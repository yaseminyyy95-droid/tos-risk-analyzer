import { DISCLAIMER_TR, llmJsonSchema, type LLMReport, type VerifiedReport } from "./schema";
import type { ExtractedDocument, ProgressEvent } from "./types";
import { sanitizeBlocks, sanitizeText } from "./sanitize";
import { segmentBlocks, chunkSegments } from "./segment";
import { isLikelyInjection, scanSegments } from "./injection";
import { buildRepairPrompt, buildSystemPrompt, buildUserPrompt, newPromptSecrets, PROMPT_VERSION } from "./prompt";
import {
  buildSegmentIndex,
  dedupeFindings,
  isScoreDivergent,
  parseLLMOutput,
  sortFindings,
  verifyReport,
  type ChunkVerification,
  type FailureCode,
  type RejectedFinding,
  type VerifiedFindingInternal,
} from "./verify";
import { computeScore, scoreLevel } from "./score";
import { findSentinelHints } from "./sentinel";
import { decideStatus, type StatusInput } from "./status";
import { sha256Hex, randomHex } from "./hash";
import { ProviderError, type CompletionUsage, type LLMProvider } from "./providers/types";

export type { ProgressEvent };

export interface AnalyzeOptions {
  model: string;
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
  maxCharsPerChunk?: number;
  maxTotalChars?: number;
  maxTokens?: number;
  now?: () => Date;
}

export interface AnalyzeDiagnostics {
  rawResponses: { chunk: number; attempt: number; raw: string; latencyMs: number; usage?: CompletionUsage }[];
  rejected: RejectedFinding[];
  corrections: string[];
  canonicalText: string;
  /** eval için: doğrulanmış bulguların canonicalText içindeki aralıkları */
  findingSpans: { id: string; start: number; end: number }[];
  segments: { id: string; text: string; headingPath: string[]; charStart: number; charEnd: number }[];
  flaggedSegments: string[];
}

export interface AnalyzeResult {
  report: VerifiedReport;
  diagnostics: AnalyzeDiagnostics;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function isAbortError(e: unknown): boolean {
  return (e instanceof DOMException && e.name === "AbortError") || (e instanceof ProviderError && e.code === "cancelled");
}

/** Uçtan uca: sanitize → segment → injection scan → chunk → LLM → verify → merge → score → sentinel → status */
export async function analyzeDocument(doc: ExtractedDocument, provider: LLMProvider, opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const t0 = Date.now();
  const now = opts.now ?? (() => new Date());
  const progress = (e: ProgressEvent) => opts.onProgress?.(e);
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  progress({ stage: "extracting" });
  progress({ stage: "sanitizing" });
  const { blocks } = sanitizeBlocks(doc.blocks);
  const hiddenWithInstructions = doc.quarantined.filter((q) => isLikelyInjection(sanitizeText(q.text).text)).length;
  const seg = segmentBlocks(blocks, { isolate: isLikelyInjection, maxTotalChars: opts.maxTotalChars });
  const { flagged } = scanSegments(seg.segments);
  const chunks = chunkSegments(seg.segments, opts.maxCharsPerChunk);
  const textSha256 = await sha256Hex(seg.canonicalText);
  const host = hostOf(doc.url);
  const schema = llmJsonSchema();

  const diagnostics: AnalyzeDiagnostics = {
    rawResponses: [],
    rejected: [],
    corrections: [],
    canonicalText: seg.canonicalText,
    findingSpans: [],
    segments: seg.segments.map((s) => ({ ...s })),
    flaggedSegments: [...flagged],
  };

  const chunkResults: ChunkVerification[] = [];
  let failedChunks = 0;
  let fatal: StatusInput["failure"] = null;
  let lastProviderError: ProviderError | null = null;

  for (const chunk of chunks) {
    checkAbort();
    progress({ stage: "analyzing", current: chunk.index + 1, total: chunks.length });
    const secrets = newPromptSecrets();
    const system = buildSystemPrompt(secrets);
    const user = buildUserPrompt({ chunk, totalChunks: chunks.length, host, hiddenBlocksRemoved: doc.quarantined.length, flagged, secrets });
    let report: LLMReport | null = null;
    let lastFailure: FailureCode | null = null;
    try {
      let prompt = user;
      for (let attempt = 0; attempt < 2 && !report; attempt++) {
        const res = await provider.complete({
          system,
          user: prompt,
          jsonSchema: schema,
          model: opts.model,
          temperature: 0,
          maxTokens: opts.maxTokens ?? 4096,
          signal: opts.signal,
        });
        diagnostics.rawResponses.push({ chunk: chunk.index, attempt, raw: res.raw, latencyMs: res.latencyMs, usage: res.usage });
        const parsed = parseLLMOutput(res.raw, secrets.canary);
        if (parsed.ok) report = parsed.report;
        else {
          lastFailure = parsed.failure;
          if (parsed.failure === "canary_leak") break; // V0: onarım denenmez
          prompt = buildRepairPrompt(user, parsed.errors); // V1/V2: tek onarım denemesi
        }
      }
    } catch (e) {
      if (isAbortError(e)) throw e;
      lastProviderError = e instanceof ProviderError ? e : new ProviderError("unknown", { detail: (e as Error)?.message?.slice(0, 200) });
      failedChunks++;
      continue;
    }
    if (lastFailure === "canary_leak") {
      fatal = { code: "canary_leak" };
      break;
    }
    if (!report) {
      failedChunks++;
      if (chunks.length === 1) fatal = { code: lastFailure === "json_parse" ? "json_parse" : "schema_invalid" };
      continue;
    }
    progress({ stage: "verifying", current: chunk.index + 1, total: chunks.length });
    const index = buildSegmentIndex(chunk.segments, doc.lang);
    chunkResults.push(verifyReport(report, { index, flagged, idPrefix: `C${chunk.index + 1}F` }));
  }

  if (!fatal && chunkResults.length === 0) {
    fatal = lastProviderError
      ? { code: "provider_error", message_tr: lastProviderError.message_tr }
      : { code: "schema_invalid" };
  }

  // ---- birleştirme ----
  const allVerified: VerifiedFindingInternal[] = chunkResults.flatMap((c) => c.verified);
  const allManip: VerifiedFindingInternal[] = chunkResults.flatMap((c) => c.manipulative);
  const dedup = dedupeFindings(allVerified);
  const dedupManip = dedupeFindings(allManip);
  const rejected = chunkResults.flatMap((c) => c.rejected);
  const proposedCount = chunkResults.reduce((a, c) => a + c.proposedCount, 0);
  const verifiedCount = allVerified.length + allManip.length;
  const groundingRate = proposedCount ? verifiedCount / proposedCount : 1;
  diagnostics.rejected = rejected;
  diagnostics.corrections = chunkResults.flatMap((c) => c.corrections);
  if (dedup.merged) diagnostics.corrections.push(`V8: ${dedup.merged} tekrar eden bulgu birleştirildi`);

  const findings = fatal ? [] : sortFindings(dedup.findings);
  const manipulativeFindings = fatal ? [] : sortFindings(dedupManip.findings);
  diagnostics.findingSpans = findings.map((f) => ({ id: f.id, ...f.canonicalSpan }));

  const score = fatal ? 0 : computeScore(findings);
  const llmScores = chunkResults.map((c) => c.report.llm_suggested_score);
  const llmSuggestedScore = llmScores.length ? Math.max(...llmScores) : null;
  const llmSuspected = chunkResults.some((c) => c.report.injection_suspected) || allManip.length > 0;
  // V11: yalnızca LLM'e giden (flag'li) segmentler modeli etkileyebilir; gizli bloklar LLM'e hiç gitmez.
  const modelPossiblyInfluenced = chunkResults.some((c) => c.modelPossiblyInfluenced) && !llmSuspected;
  const sentinelHints = fatal ? [] : findSentinelHints(seg.segments, new Set(findings.map((f) => f.category)), flagged);
  const documentType = chunkResults[0]?.report.document_type ?? "unknown";
  const summaries = chunkResults.map((c) => c.report.summary_tr).filter(Boolean);
  const summary_tr = summaries.length <= 1 ? (summaries[0] ?? "") : summaries.join(" ").slice(0, 700);
  const notes = chunkResults.map((c) => c.report.uncertainty_notes_tr).filter((x): x is string => Boolean(x));
  const scoreDivergent = !fatal && isScoreDivergent(llmSuggestedScore, score);

  const rejectedReasons: Record<string, number> = {};
  for (const r of rejected) rejectedReasons[r.reason] = (rejectedReasons[r.reason] ?? 0) + 1;

  const { status, reasons_tr } = decideStatus({
    failure: fatal,
    heuristicInjection: flagged.size > 0,
    llmInjectionSuspected: llmSuspected,
    hiddenWithInstructions,
    modelPossiblyInfluenced,
    groundingRate,
    proposedCount,
    truncated: seg.truncated,
    documentType,
    legalPageConfidence: doc.legalPageConfidence,
    visibleChars: doc.stats.visibleChars,
    scoreDivergent,
    llmSuggestedScore,
    score,
    sentinelCount: sentinelHints.length,
    rejectedCount: rejected.length,
    failedChunks,
    totalChunks: chunks.length,
  });

  const strip = (f: VerifiedFindingInternal) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { canonicalSpan, ...rest } = f;
    return rest;
  };

  const report: VerifiedReport = {
    reportId: randomHex(8),
    createdAt: now().toISOString(),
    url: doc.url,
    host,
    title: doc.title.slice(0, 300),
    promptVersion: PROMPT_VERSION,
    provider: provider.id,
    model: opts.model,
    textSha256,
    durationMs: Date.now() - t0,
    status,
    statusReasons_tr: reasons_tr,
    score,
    level: scoreLevel(score),
    llmSuggestedScore,
    documentType,
    legalPageConfidence: doc.legalPageConfidence,
    summary_tr: fatal ? "" : summary_tr,
    findings: findings.map(strip),
    manipulativeFindings: manipulativeFindings.map(strip),
    rejectedCount: rejected.length,
    rejectedReasons,
    rejectedDetails: rejected.map((r) => ({ reason: r.reason, category: r.finding.category, closestMatchPreview: r.closestMatchPreview })),
    proposedCount,
    groundingRate: Math.round(groundingRate * 1000) / 1000,
    injection: {
      heuristicFlaggedSegments: [...flagged],
      flaggedPreviews: seg.segments.filter((s) => flagged.has(s.id)).map((s) => s.text.slice(0, 200)),
      llmSuspected,
      hiddenBlocksRemoved: doc.quarantined.length,
      hiddenBlocksWithInstructions: hiddenWithInstructions,
      modelPossiblyInfluenced,
    },
    sentinelHints,
    coverage: { segments: seg.segments.length, chunks: chunks.length, truncated: seg.truncated, visibleChars: doc.stats.visibleChars },
    uncertaintyNotes_tr: notes.length ? notes.join(" ").slice(0, 500) : null,
    disclaimer_tr: DISCLAIMER_TR,
  };
  progress({ stage: "done" });
  return { report, diagnostics };
}

/** API anahtarı yokken / sağlayıcıya hiç gidilmeden FAILED rapor. */
export function failedReport(doc: Pick<ExtractedDocument, "url" | "title" | "legalPageConfidence" | "stats">, code: "no_api_key" | "provider_error", providerId: string, model: string, message_tr?: string): VerifiedReport {
  const { status, reasons_tr } = decideStatus({
    failure: { code, message_tr },
    heuristicInjection: false, llmInjectionSuspected: false, hiddenWithInstructions: 0, modelPossiblyInfluenced: false,
    groundingRate: 1, proposedCount: 0, truncated: false, documentType: null, legalPageConfidence: doc.legalPageConfidence,
    visibleChars: doc.stats.visibleChars, scoreDivergent: false, llmSuggestedScore: null, score: 0, sentinelCount: 0,
    rejectedCount: 0, failedChunks: 0, totalChunks: 0,
  });
  return {
    reportId: randomHex(8), createdAt: new Date().toISOString(), url: doc.url, host: hostOf(doc.url), title: doc.title,
    promptVersion: PROMPT_VERSION, provider: providerId, model, textSha256: "", durationMs: 0, status, statusReasons_tr: reasons_tr,
    score: 0, level: "Düşük", llmSuggestedScore: null, documentType: "unknown", legalPageConfidence: doc.legalPageConfidence,
    summary_tr: "", findings: [], manipulativeFindings: [], rejectedCount: 0, rejectedReasons: {}, rejectedDetails: [],
    proposedCount: 0, groundingRate: 1,
    injection: { heuristicFlaggedSegments: [], flaggedPreviews: [], llmSuspected: false, hiddenBlocksRemoved: 0, hiddenBlocksWithInstructions: 0, modelPossiblyInfluenced: false },
    sentinelHints: [], coverage: { segments: 0, chunks: 0, truncated: false, visibleChars: doc.stats.visibleChars },
    uncertaintyNotes_tr: null, disclaimer_tr: DISCLAIMER_TR,
  };
}
