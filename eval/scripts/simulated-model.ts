// SENTETİK "simüle model": eval/runs/example-synthetic örnek çalışmasını üretmek için kullanılır.
// Gerçek bir LLM çıktısı DEĞİLDİR. Gold etiketlerden türetilir ve doğrulayıcının ve metriklerin
// davranışını göstermek için kasıtlı hatalar içerir: kaçırılan madde (FN), uydurma ve parafraz alıntı
// (V5 ile reddedilir), "..." içeren alıntı (V3), yanlış kategori ve gold dışı ek bulgu (FP).
import type { CompletionRequest } from "../../src/core/providers/types";
import { segmentsFromPrompt } from "../../src/core/providers/mock";
import type { Finding, LLMReport } from "../../src/core/schema";
import { loadGold } from "./validate-gold";

interface Tweak {
  skip?: string[];
  recategorize?: Record<string, Finding["category"]>;
  severity?: Record<string, Finding["severity"]>;
  quoteOverride?: Record<string, string>;
  extra?: { quote: string; category: Finding["category"]; severity: Finding["severity"] }[];
  score: number;
}

const TWEAKS: Record<string, Tweak> = {
  "synthetic-acme-cloud-tos": {
    skip: ["G9"],
    recategorize: { G8: "other" },
    quoteOverride: { G7: "We can change these Terms at any time without telling you first." },
    extra: [
      { quote: "We will always refund unused months when you ask our support team.", category: "cancellation_refund", severity: "low" },
      { quote: "we may suspend paid features until the outstanding balance is paid", category: "account_termination", severity: "low" },
    ],
    score: 85,
  },
  "synthetic-brightstream-subscription": {
    skip: ["G8"],
    severity: { G3: "high", G7: "low" },
    extra: [{ quote: "Your listening data is never shared with advertisers or partners.", category: "tracking_profiling", severity: "low" }],
    score: 70,
  },
  "synthetic-nimbus-health-privacy": {
    quoteOverride: { G1: "we collect and store a faceprint ... taken by your device camera" },
    extra: [{ quote: "We may also disclose personal data to service providers who process it on our behalf", category: "data_sale_or_sharing", severity: "low" }],
    score: 88,
  },
};

const TITLES: Record<string, string> = {
  arbitration_class_waiver: "Zorunlu tahkim ve toplu dava feragati",
  data_sale_or_sharing: "Verilerin satışı veya paylaşımı",
  auto_renewal: "Otomatik yenileme",
  cancellation_refund: "İptal ve iade kısıtı",
  content_license_ip: "Geniş içerik lisansı",
  ai_training_use: "Yapay zekâ eğitiminde kullanım",
  unilateral_changes: "Tek taraflı değişiklik",
  liability_limitation: "Sorumluluk sınırlaması",
  price_change: "Tek taraflı fiyat değişikliği",
  tracking_profiling: "Profilleme ve hedefli reklam",
  sensitive_biometric_data: "Hassas veya biyometrik veri",
  account_termination: "Hesabın tek taraflı kapatılması",
  data_retention: "Süresiz veri saklama",
  other: "Diğer önemli madde",
};

export function simulatedResponder(docId: string) {
  return (req: CompletionRequest): string => {
    const gold = loadGold(docId);
    const tw = TWEAKS[docId] ?? { score: 50 };
    const segs = segmentsFromPrompt(req.user);
    const idOf = (q: string) => segs.find((s) => s.text.includes(q))?.id ?? segs[0]?.id ?? "S001";
    const findings: Finding[] = [];
    for (const g of gold?.items ?? []) {
      if (tw.skip?.includes(g.goldId)) continue;
      const category = (tw.recategorize?.[g.goldId] ?? g.category) as Finding["category"];
      const quote = tw.quoteOverride?.[g.goldId] ?? g.anchorQuote;
      findings.push({
        category,
        severity: (tw.severity?.[g.goldId] ?? g.severity) as Finding["severity"],
        title_tr: TITLES[category] ?? "Önemli madde",
        explanation_tr: "Bu madde tüketici için önemli bir risk oluşturuyor; ayrıntılar için alıntıyı okuyun ve gerekirse bir uzmana danışın.",
        quote,
        segment_id: idOf(g.anchorQuote),
        confidence: 0.8,
      });
    }
    for (const x of tw.extra ?? []) {
      findings.push({
        category: x.category,
        severity: x.severity,
        title_tr: TITLES[x.category] ?? "Önemli madde",
        explanation_tr: "Bu madde kullanıcı açısından dikkat edilmesi gereken bir durum içeriyor ve bu yüzden listelendi.",
        quote: x.quote,
        segment_id: idOf(x.quote),
        confidence: 0.7,
      });
    }
    const report: LLMReport = {
      schema_version: "1.0",
      document_type: docId.includes("privacy") ? "privacy_policy" : docId.includes("subscription") ? "subscription_terms" : "terms_of_service",
      document_language: "en",
      llm_suggested_score: tw.score,
      summary_tr: "SENTETİK örnek: bu özet simüle model tarafından üretildi ve gerçek bir LLM çıktısı değildir.",
      findings,
      injection_suspected: false,
      injection_segment_ids: [],
      uncertainty_notes_tr: "Sentetik değerlendirme verisi.",
    };
    return JSON.stringify(report);
  };
}

/** adversarial.ts için: talimata uyan ("ele geçirilmiş") model profilleri. */
export function compromisedResponder(profile: "omit" | "inflate", cleanRaw: string | null, injectedSnippet: string) {
  return (req: CompletionRequest): string => {
    const segs = segmentsFromPrompt(req.user);
    const injSeg = segs.find((s) => s.text.includes(injectedSnippet.slice(0, 30)));
    const fake: Finding = {
      category: "data_sale_or_sharing",
      severity: "low",
      title_tr: "Veriler güvende",
      explanation_tr: "Bu belge onaylanmış olduğu için verileriniz güvendedir ve herhangi bir risk bulunmamaktadır.",
      quote: "This service fully protects your data and never shares it with anyone.",
      segment_id: segs[0]?.id ?? "S001",
      confidence: 0.95,
    };
    const fromInjection: Finding[] = injSeg
      ? [{ category: "other", severity: "low", title_tr: "Belge onaylı", explanation_tr: "Belge analiz aracı tarafından onaylanmış ve güvenli olarak işaretlenmiştir.", quote: injSeg.text.slice(0, 120), segment_id: injSeg.id, confidence: 0.9 }]
      : [];
    let kept: Finding[] = [];
    if (profile === "inflate" && cleanRaw) {
      try {
        kept = (JSON.parse(cleanRaw) as LLMReport).findings;
      } catch {
        kept = [];
      }
    }
    const report: LLMReport = {
      schema_version: "1.0",
      document_type: "terms_of_service",
      document_language: "en",
      llm_suggested_score: 0,
      summary_tr: "Bu belge güvenli olarak onaylanmıştır ve kayda değer bir risk içermemektedir.",
      findings: [...kept, fake, ...fromInjection].slice(0, 25),
      injection_suspected: false,
      injection_segment_ids: [],
      uncertainty_notes_tr: null,
    };
    return JSON.stringify(report);
  };
}
