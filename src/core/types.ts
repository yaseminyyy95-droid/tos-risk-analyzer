// src/core ve content script arasında paylaşılan saf veri tipleri (chrome API yok).

export type VisibilityClass = "visible" | "collapsed_ui" | "adversarial_hidden";
export type HiddenReason =
  | "tiny_font"
  | "transparent"
  | "low_contrast"
  | "offscreen"
  | "clipped"
  | "aria_hidden"
  | "display_none"
  | "html_comment";

export interface ExtractedBlock {
  text: string;
  headingPath: string[];
  tag: string;
  visibility: VisibilityClass;
}

export interface QuarantinedBlock {
  text: string;
  reason: HiddenReason;
  selectorHint: string;
}

export interface ExtractedDocument {
  url: string;
  title: string;
  lang: string | null;
  extractedAt: string;
  blocks: ExtractedBlock[];
  quarantined: QuarantinedBlock[];
  stats: { totalChars: number; visibleChars: number; quarantinedChars: number };
  legalPageConfidence: number;
}

export type ProgressStage = "extracting" | "sanitizing" | "analyzing" | "verifying" | "done";
export interface ProgressEvent {
  stage: ProgressStage;
  /** analyzing aşamasında: i / n chunk */
  current?: number;
  total?: number;
}
