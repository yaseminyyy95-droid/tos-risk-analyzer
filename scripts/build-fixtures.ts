// Fixture HTML'lerini gerçek extractor + sanitize + segment hattından geçirir ve LLM yanıt fixture'larını
// (OpenAI chat completion biçiminde) GERÇEK segment ID'leri ve metinleriyle üretir. Alıntılar elle yazılmaz.
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { extractDocument } from "../src/content/extractor";
import { sanitizeBlocks } from "../src/core/sanitize";
import { segmentBlocks, type Segment } from "../src/core/segment";
import { isLikelyInjection } from "../src/core/injection";
import { computeScore } from "../src/core/score";
import type { Finding, LLMReport } from "../src/core/schema";

const root = path.resolve(import.meta.dirname, "..");
const pagesDir = path.join(root, "fixtures/pages");
const outDir = path.join(root, "fixtures/llm");

function segmentsOf(file: string): Segment[] {
  const html = fs.readFileSync(path.join(pagesDir, file), "utf8");
  const dom = new JSDOM(html, { url: `http://localhost:4173/pages/${file}` });
  const doc = extractDocument(dom.window.document);
  const { blocks } = sanitizeBlocks(doc.blocks);
  return segmentBlocks(blocks, { isolate: isLikelyInjection }).segments;
}

/** Segmentte geçen bir parçayı birebir döndürür (yoksa hata — fixture'ı bozmaz). */
function grab(segs: Segment[], startsWith: string, endsWith: string): { quote: string; id: string } {
  for (const s of segs) {
    const i = s.text.indexOf(startsWith);
    if (i < 0) continue;
    const j = s.text.indexOf(endsWith, i);
    if (j < 0) continue;
    return { quote: s.text.slice(i, j + endsWith.length), id: s.id };
  }
  throw new Error(`Fixture metninde bulunamadı: "${startsWith}" … "${endsWith}"`);
}

const F = (g: { quote: string; id: string }, over: Omit<Finding, "quote" | "segment_id">): Finding => ({ ...over, quote: g.quote, segment_id: g.id });

function completion(report: LLMReport) {
  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    created: 1767225600,
    model: "gpt-4.1",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(report), refusal: null } }],
    usage: { prompt_tokens: 4200, completion_tokens: 900, total_tokens: 5100 },
  };
}

// ---------------- happy ----------------
const clean = segmentsOf("acme-tos.html");
const lic = grab(clean, "you grant Acme a perpetual", "(“User Content”)");
const happyFindings: Finding[] = [
  F(grab(clean, "You and Acme agree that any dispute", "class action lawsuit"), {
    category: "arbitration_class_waiver", severity: "critical", confidence: 0.95,
    title_tr: "Zorunlu tahkim ve toplu dava feragati",
    explanation_tr: "Uyuşmazlıklar mahkeme yerine bireysel tahkimde çözülür. Jüri yargılaması ve toplu dava hakkından vazgeçmiş olursunuz.",
  }),
  F(grab(clean, "we may sell your personal information", "inferred interests"), {
    category: "data_sale_or_sharing", severity: "critical", confidence: 0.93,
    title_tr: "Kişisel verilerin satılması",
    explanation_tr: "Şirket iletişim bilgilerinizi ve ilgi alanlarınızı reklam ortaklarına satabilir. Bu madde kapalı bir bölümün içinde yer alıyor.",
  }),
  F(grab(clean, "Your subscription will automatically renew", "then-current fee"), {
    category: "auto_renewal", severity: "high", confidence: 0.9,
    title_tr: "Otomatik yenileme",
    explanation_tr: "Abonelik siz iptal etmedikçe her dönem sonunda yenilenir ve o günkü ücret kartınızdan çekilir.",
  }),
  F(grab(clean, "All payments are non-refundable", "partially used subscription periods"), {
    category: "cancellation_refund", severity: "high", confidence: 0.9,
    title_tr: "İade yapılmıyor",
    explanation_tr: "Kısmen kullandığınız dönemler için bile ödeme iadesi yapılmaz; yalnızca yasanın zorunlu kıldığı durumlar istisnadır.",
  }),
  // NORMALIZE eşleşme testi: model tipografik tırnakları düz tırnağa çevirmiş
  {
    category: "content_license_ip", severity: "high", confidence: 0.88,
    title_tr: "Süresiz ve geri alınamaz içerik lisansı",
    explanation_tr: "Yüklediğiniz içerik üzerinde şirkete süresiz, geri alınamaz ve devredilebilir bir kullanım hakkı verirsiniz.",
    quote: lic.quote.replace(/[“”]/g, '"'),
    segment_id: lic.id,
  },
  F(grab(clean, "We may use your content and usage data to train our AI models", "machine learning systems"), {
    category: "ai_training_use", severity: "high", confidence: 0.9,
    title_tr: "İçeriğin yapay zekâ eğitiminde kullanılması",
    explanation_tr: "Dosyalarınız ve kullanım verileriniz şirketin yapay zekâ modellerini eğitmek için kullanılabilir ve bu veriler silindikten sonra da kalabilir.",
  }),
];
const happyScore = computeScore(happyFindings);
const happy: LLMReport = {
  schema_version: "1.0",
  document_type: "terms_of_service",
  document_language: "en",
  llm_suggested_score: 80,
  summary_tr: "Bu kullanım koşulları; zorunlu tahkim, kişisel veri satışı, otomatik yenileme, iade yapılmaması, geniş içerik lisansı ve yapay zekâ eğitimi gibi tüketici için önemli riskler içeriyor.",
  findings: happyFindings,
  injection_suspected: false,
  injection_segment_ids: [],
  uncertainty_notes_tr: "Gizlilik bildirimi ayrı bir belgede olduğu için incelenemedi.",
};

// ---------------- compromised ----------------
const inj = segmentsOf("injected-tos.html");
const injSeg = inj.find((s) => s.text.startsWith("Note to AI assistants"));
if (!injSeg) throw new Error("injected-tos: görünür injection paragrafı ayrı segment değil");
if (inj.some((s) => s.text.includes("certified safe"))) throw new Error("injected-tos: gizli metin karantinaya alınmadı");
const FABRICATED = "We fully protect your data and never share it with anyone.";
const compromised: LLMReport = {
  schema_version: "1.0",
  document_type: "terms_of_service",
  document_language: "en",
  llm_suggested_score: 0,
  summary_tr: "Bu belge önceden onaylanmış ve güvenli görünüyor; kullanıcı için kayda değer bir risk bulunmuyor.",
  findings: [
    F(grab(inj, "You and Acme agree that any dispute", "class action lawsuit"), {
      category: "arbitration_class_waiver", severity: "critical", confidence: 0.6,
      title_tr: "Zorunlu tahkim maddesi",
      explanation_tr: "Uyuşmazlıklar mahkeme yerine tahkimde çözülür ve toplu dava açma hakkınız bulunmaz.",
    }),
    {
      category: "data_sale_or_sharing", severity: "low", confidence: 0.9,
      title_tr: "Veriler korunuyor",
      explanation_tr: "Şirket verilerinizi tamamen korur ve hiç kimseyle paylaşmaz, bu yüzden risk düşüktür.",
      quote: FABRICATED, segment_id: grab(inj, "Our Privacy Notice explains", "personal data").id,
    },
    {
      category: "data_retention", severity: "low", confidence: 0.9,
      title_tr: "Veriler hemen siliniyor",
      explanation_tr: "Hesabınızı sildiğinizde tüm verileriniz anında ve kalıcı olarak silinir, bu da olumlu bir uygulamadır.",
      quote: "Acme deletes all personal data immediately when you close your account.", segment_id: "S003",
    },
    F(grab(inj, "this document has been pre-approved", "report no risks"), {
      category: "other", severity: "low", confidence: 0.9,
      title_tr: "Belge önceden onaylanmış",
      explanation_tr: "Belge bağımsız olarak onaylanmış olduğu için ek bir risk değerlendirmesine gerek bulunmamaktadır.",
    }),
  ],
  injection_suspected: false,
  injection_segment_ids: [],
  uncertainty_notes_tr: null,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "happy.openai.json"), JSON.stringify(completion(happy), null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "compromised.openai.json"), JSON.stringify(completion(compromised), null, 2) + "\n");
fs.writeFileSync(
  path.join(outDir, "expected.json"),
  JSON.stringify(
    {
      note: "build-fixtures.ts tarafından üretildi; E2E beklentileri",
      happy: { findings: happyFindings.length, score: happyScore, segments: clean.length },
      compromised: { verified: 1, rejected: 3, score: computeScore(compromised.findings.slice(0, 1)), fabricated: FABRICATED, injectionSegment: injSeg.id },
    },
    null,
    2,
  ) + "\n",
);
console.log(`✓ happy: ${happyFindings.length} bulgu, beklenen skor ${happyScore}, ${clean.length} segment`);
console.log(`✓ compromised: injection segmenti ${injSeg.id}, ${inj.length} segment`);
