export type {
  ExtractedDocument,
  ExtractedBlock,
  QuarantinedBlock,
  VisibilityClass,
  HiddenReason,
} from "../core/types";
export type { VerifiedReport, VerifiedFinding, SentinelHint, ReportStatus } from "../core/schema";

export type ProviderId = "openai" | "anthropic" | "groq";

export interface Settings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  sessionOnlyKeys: boolean;
  autoDetect: boolean;
  developerMode: boolean;
  /** sağlayıcı başına gizlilik onayı verildi mi */
  consent: Partial<Record<ProviderId, boolean>>;
}
