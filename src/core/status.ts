import type { ReportStatus } from "./schema";

export interface StatusInput {
  failure: null | { code: "canary_leak" | "schema_invalid" | "provider_error" | "no_api_key" | "json_parse"; message_tr?: string };
  heuristicInjection: boolean;
  llmInjectionSuspected: boolean;
  hiddenWithInstructions: number;
  modelPossiblyInfluenced: boolean;
  groundingRate: number;
  proposedCount: number;
  truncated: boolean;
  documentType: string | null;
  legalPageConfidence: number;
  visibleChars: number;
  scoreDivergent: boolean;
  llmSuggestedScore: number | null;
  score: number;
  sentinelCount: number;
  rejectedCount: number;
  failedChunks: number;
  totalChunks: number;
}

export const STATUS_LABEL_TR: Record<ReportStatus, string> = {
  OK: "Doğrulandı",
  PARTIAL: "Kısmen doğrulandı",
  UNCERTAIN: "Belirsiz — manuel inceleme önerilir",
  FAILED: "Analiz başarısız",
};

export function decideStatus(i: StatusInput): { status: ReportStatus; reasons_tr: string[] } {
  if (i.failure) {
    const map: Record<string, string> = {
      canary_leak: "Model, gizli talimat işaretini çıktıya sızdırdı; rapor güvenilir değil.",
      schema_invalid: "Model çıktısı beklenen biçime uymadı (bir düzeltme denemesinden sonra da).",
      json_parse: "Model çıktısı geçerli JSON değildi (bir düzeltme denemesinden sonra da).",
      provider_error: "LLM sağlayıcısına ulaşılamadı veya sağlayıcı hata döndürdü.",
      no_api_key: "API anahtarı tanımlı değil.",
    };
    const reasons = [map[i.failure.code] ?? "Analiz başarısız."];
    if (i.failure.message_tr) reasons.push(i.failure.message_tr);
    return { status: "FAILED", reasons_tr: reasons };
  }

  const uncertain: string[] = [];
  if (i.heuristicInjection || i.llmInjectionSuspected || i.hiddenWithInstructions > 0) {
    const parts: string[] = [];
    if (i.heuristicInjection) parts.push("görünür metinde yapay zekâya yönelik talimat kalıpları bulundu");
    if (i.hiddenWithInstructions > 0) parts.push(`${i.hiddenWithInstructions} gizli blokta talimat içeren metin tespit edildi`);
    if (i.llmInjectionSuspected) parts.push("model de yönlendirme girişimi bildirdi");
    uncertain.push(`Prompt injection şüphesi: ${parts.join("; ")}.`);
  }
  if (i.modelPossiblyInfluenced)
    uncertain.push("Model etkilenmiş olabilir: tarayıcı talimat kalıbı buldu ama model yönlendirme girişimi bildirmedi.");
  if (i.proposedCount >= 3 && i.groundingRate < 0.6)
    uncertain.push(`Modelin iddialarının yalnızca %${Math.round(i.groundingRate * 100)}'i metinde doğrulanabildi.`);
  if (i.truncated) uncertain.push("Metin çok uzun olduğu için analiz sırasında kırpıldı; sonraki bölümler incelenmedi.");
  if (i.documentType === "not_legal_document" || i.legalPageConfidence < 0.4)
    uncertain.push("Bu sayfa bir hukuki metin gibi görünmüyor; sonuçlar anlamsız olabilir.");
  if (i.visibleChars < 1500) uncertain.push("Sayfadan çok az metin çıkarılabildi; doküman eksik olabilir.");
  if (i.scoreDivergent)
    uncertain.push(
      `Modelin önerdiği skor (${i.llmSuggestedScore ?? "-"}) ile doğrulanmış bulgulardan hesaplanan skor (${i.score}) arasında büyük sapma var.`,
    );
  if (i.sentinelCount >= 2)
    uncertain.push(`${i.sentinelCount} riskli anahtar kelime için doğrulanmış bulgu yok; model bazı maddeleri kaçırmış olabilir.`);

  const partial: string[] = [];
  if (i.rejectedCount > 0) partial.push(`${i.rejectedCount} iddia orijinal metinde doğrulanamadığı için çıkarıldı.`);
  if (i.failedChunks > 0 && i.failedChunks < i.totalChunks)
    partial.push(`${i.totalChunks} bölümden ${i.failedChunks} tanesi analiz edilemedi.`);

  if (uncertain.length) return { status: "UNCERTAIN", reasons_tr: [...uncertain, ...partial] };
  if (partial.length) return { status: "PARTIAL", reasons_tr: partial };
  return { status: "OK", reasons_tr: ["Tüm bulgular orijinal metindeki birebir alıntılarla doğrulandı."] };
}
