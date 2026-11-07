import { z } from "zod";
import type { VerifiedReport } from "../core/schema";
import type { ExtractedDocument } from "../core/types";
import type { ProgressEvent } from "../core/types";

// ---------------- Content script'ten gelen (GÜVENİLMEZ) veri ----------------
// Sayfa ele geçirilmiş olabilir: boyutlar sınırlanır, ekstra alan kabul edilmez.

const MAX_TEXT = 20_000;
export const ExtractedDocumentSchema = z
  .object({
    url: z.string().max(4096),
    title: z.string().max(1000),
    lang: z.string().max(35).nullable(),
    extractedAt: z.string().max(64),
    blocks: z
      .array(
        z
          .object({
            text: z.string().max(MAX_TEXT),
            headingPath: z.array(z.string().max(500)).max(12),
            tag: z.string().max(20),
            visibility: z.enum(["visible", "collapsed_ui", "adversarial_hidden"]),
          })
          .strict(),
      )
      .max(10_000),
    quarantined: z
      .array(
        z
          .object({
            text: z.string().max(MAX_TEXT),
            reason: z.enum([
              "tiny_font",
              "transparent",
              "low_contrast",
              "offscreen",
              "clipped",
              "aria_hidden",
              "display_none",
              "html_comment",
            ]),
            selectorHint: z.string().max(200),
          })
          .strict(),
      )
      .max(2000),
    stats: z
      .object({
        totalChars: z.number().nonnegative(),
        visibleChars: z.number().nonnegative(),
        quarantinedChars: z.number().nonnegative(),
      })
      .strict(),
    legalPageConfidence: z.number().min(0).max(1),
  })
  .strict();

/** SW → content script istekleri */
export type ContentRequest =
  | { type: "CONTENT_EXTRACT" }
  | { type: "CONTENT_EXTRACT_SELECTION" }
  | { type: "HIGHLIGHT_QUOTE"; quote: string; lang: string | null };

export const ContentResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("EXTRACT_RESULT"), doc: ExtractedDocumentSchema }).strict(),
  z.object({ type: z.literal("HIGHLIGHT_RESULT"), found: z.boolean(), method: z.string().max(40).nullable() }).strict(),
  z.object({ type: z.literal("ERROR"), code: z.string().max(60), message_tr: z.string().max(500) }).strict(),
]);
export type ContentResponse = z.infer<typeof ContentResponseSchema>;

export const LegalDetectedSchema = z
  .object({ type: z.literal("LEGAL_PAGE_DETECTED"), confidence: z.number().min(0).max(1) })
  .strict();

// ---------------- UI (side panel) ⇄ SW port protokolü ----------------
export const PORT_NAME = "analysis";

export const PanelToSwSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ANALYZE_TAB"), tabId: z.number().int(), bypassCache: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("ANALYZE_SELECTION"), tabId: z.number().int() }).strict(),
  z.object({ type: z.literal("HIGHLIGHT_QUOTE"), tabId: z.number().int(), quote: z.string().max(600), lang: z.string().max(35).nullable() }).strict(),
  z.object({ type: z.literal("CANCEL") }).strict(),
  z.object({ type: z.literal("GET_STATE"), tabId: z.number().int() }).strict(),
  z.object({ type: z.literal("GRANT_CONSENT"), provider: z.enum(["openai", "anthropic", "groq"]) }).strict(),
]);
export type PanelToSw = z.infer<typeof PanelToSwSchema>;

export type SwToPanel =
  | { type: "PROGRESS"; event: ProgressEvent }
  | { type: "REPORT"; report: VerifiedReport; fromCache: boolean }
  | { type: "ERROR"; code: ErrorCode; message_tr: string }
  | { type: "NEEDS_CONSENT"; provider: string; providerLabel: string }
  | { type: "STATE"; state: "idle" | "running" | "interrupted"; report: VerifiedReport | null }
  | { type: "HIGHLIGHT_RESULT"; found: boolean };

export type ErrorCode =
  | "NO_API_KEY"
  | "NO_TAB"
  | "INJECTION_FAILED"
  | "EXTRACTION_INVALID"
  | "EMPTY_DOCUMENT"
  | "CANCELLED"
  | "INTERNAL";

export type { ExtractedDocument };
