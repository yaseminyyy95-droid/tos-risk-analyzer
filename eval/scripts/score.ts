// Doğrulanmış bulguları gold etiketlerle eşleştirir ve metrikleri raporlar.
//   npm run eval:score -- --run eval/runs/<run>
// Eşleşme: (span çakışması VEYA aynı/komşu segmentte ≤150 karakter mesafe) VE tahmin kategorisi
// acceptableCategories içinde. Greedy bire-bir eşleştirme (en büyük çakışma önce).
import fs from "node:fs";
import path from "node:path";
import { normalizeWithMap, normalizeForMatch } from "../../src/core/normalize";
import { STATUS_LABEL_TR } from "../../src/core/status";
import { P, ROOT, fmtPct, isMain, parseArgs, readJson, writeJson } from "./lib";
import { loadGold, type GoldFile } from "./validate-gold";
import type { DocRunRecord, RunMeta } from "./run";

export const MAX_GAP = 150;

type Span = { start: number; end: number };

export function locateInCanonical(canonical: string, quote: string): Span | null {
  const nm = normalizeWithMap(canonical);
  const q = normalizeForMatch(quote);
  const i = nm.text.indexOf(q);
  if (i < 0 || !q) return null;
  return { start: nm.map[i]!, end: nm.mapEnd[i + q.length - 1]! };
}

function segIndex(rec: DocRunRecord, pos: number): number {
  return rec.segments.findIndex((s) => pos >= s.charStart && pos <= s.charEnd);
}

export interface MatchResult {
  tp: { findingId: string; goldId: string; severityMatch: boolean }[];
  fp: { findingId: string; category: string; quote: string }[];
  fn: { goldId: string; category: string; anchorQuote: string }[];
  unlocatedGold: string[];
}

export function matchFindings(rec: DocRunRecord, gold: GoldFile): MatchResult {
  const preds = rec.report.findings.map((f) => ({ f, span: rec.findingSpans.find((s) => s.id === f.id) ?? locateInCanonical(rec.canonicalText, f.quote) }));
  const golds = gold.items.map((g) => ({ g, span: locateInCanonical(rec.canonicalText, g.anchorQuote) }));
  const cands: { pi: number; gi: number; score: number }[] = [];
  preds.forEach((p, pi) => {
    golds.forEach((g, gi) => {
      if (!p.span || !g.span) return;
      if (!g.g.acceptableCategories.includes(p.f.category)) return;
      const overlap = Math.min(p.span.end, g.span.end) - Math.max(p.span.start, g.span.start);
      if (overlap > 0) return cands.push({ pi, gi, score: overlap });
      const gap = -overlap;
      const sp = segIndex(rec, p.span.start);
      const sg = segIndex(rec, g.span.start);
      if (gap <= MAX_GAP && sp >= 0 && sg >= 0 && Math.abs(sp - sg) <= 1) cands.push({ pi, gi, score: -gap });
    });
  });
  cands.sort((a, b) => b.score - a.score);
  const usedP = new Set<number>();
  const usedG = new Set<number>();
  const tp: MatchResult["tp"] = [];
  for (const c of cands) {
    if (usedP.has(c.pi) || usedG.has(c.gi)) continue;
    usedP.add(c.pi);
    usedG.add(c.gi);
    tp.push({ findingId: preds[c.pi]!.f.id, goldId: golds[c.gi]!.g.goldId, severityMatch: preds[c.pi]!.f.severity === golds[c.gi]!.g.severity });
  }
  return {
    tp,
    fp: preds.filter((_, i) => !usedP.has(i)).map((p) => ({ findingId: p.f.id, category: p.f.category, quote: p.f.quote })),
    fn: golds.filter((_, i) => !usedG.has(i)).map((g) => ({ goldId: g.g.goldId, category: g.g.category, anchorQuote: g.g.anchorQuote })),
    unlocatedGold: golds.filter((g) => !g.span).map((g) => g.g.goldId),
  };
}

const prf = (tp: number, fp: number, fn: number) => {
  const p = tp + fp ? tp / (tp + fp) : null;
  const r = tp + fn ? tp / (tp + fn) : null;
  const f = p !== null && r !== null && p + r > 0 ? (2 * p * r) / (p + r) : p === null || r === null ? null : 0;
  return { precision: p, recall: r, f1: f };
};

type Verdict = "true_fp" | "valid_unannotated" | "unclear";
const csvEsc = (s: string) => `"${s.replace(/"/g, '""')}"`;

function readAdjudication(file: string): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  if (!fs.existsSync(file)) return m;
  const lines = fs.readFileSync(file, "utf8").split("\n").slice(1).filter(Boolean);
  for (const l of lines) {
    const cols = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) ?? [];
    const [docId, , , quote, verdict] = cols;
    if (docId && quote && (verdict === "true_fp" || verdict === "valid_unannotated" || verdict === "unclear")) m.set(`${docId}\u0000${normalizeForMatch(quote)}`, verdict);
  }
  return m;
}

export async function scoreRun(runDir: string, opts: { resultsDir?: string; writeDocs?: boolean } = {}) {
  const resultsDir = opts.resultsDir ?? P.results;
  const meta = readJson<RunMeta>(path.join(runDir, "meta.json"));
  const recs = fs
    .readdirSync(path.join(runDir, "reports"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson<DocRunRecord>(path.join(runDir, "reports", f)));
  const adjFile = path.join(resultsDir, "adjudication.csv");
  const prevVerdicts = readAdjudication(adjFile);
  const adjRows: string[] = ["docId,findingId,category,quote,verdict"];

  const perDoc: Record<string, unknown>[] = [];
  let TP = 0, FP = 0, FN = 0, proposed = 0, rejected = 0, verifiedAll = 0, sevAgree = 0, validUnannot = 0, groundingViolations = 0;
  const catHit: Record<string, { hit: number; total: number }> = {};
  const statusDist: Record<string, number> = {};
  const repeatsF1: Record<string, number[]> = {};
  let latency = 0, inTok = 0, outTok = 0;

  for (const rec of recs) {
    const gold = loadGold(rec.docId);
    const rep = rec.report;
    // invariant: her doğrulanmış alıntı kanonik metinde birebir geçer
    for (const f of [...rep.findings, ...rep.manipulativeFindings]) if (!rec.canonicalText.includes(f.quote)) groundingViolations++;
    latency += rec.latencyMs;
    inTok += rec.usage.inputTokens;
    outTok += rec.usage.outputTokens;
    if (!gold) {
      perDoc.push({ docId: rec.docId, repeat: rec.repeat, gold: null, score: rep.score, status: rep.status });
      continue;
    }
    const m = matchFindings(rec, gold);
    const s = prf(m.tp.length, m.fp.length, m.fn.length);
    (repeatsF1[rec.docId] ??= []).push(s.f1 ?? 0);
    if (rec.repeat !== 1) continue; // tablo ve toplamlar 1. tekrardan; tekrarlar ayrıca özetlenir
    TP += m.tp.length;
    FP += m.fp.length;
    FN += m.fn.length;
    proposed += rep.proposedCount;
    rejected += rep.rejectedCount;
    verifiedAll += rep.findings.length;
    sevAgree += m.tp.filter((t) => t.severityMatch).length;
    statusDist[rep.status] = (statusDist[rep.status] ?? 0) + 1;
    for (const g of gold.items) {
      const c = (catHit[g.category] ??= { hit: 0, total: 0 });
      c.total++;
      if (m.tp.some((t) => t.goldId === g.goldId)) c.hit++;
    }
    for (const fp of m.fp) {
      const v = prevVerdicts.get(`${rec.docId}\u0000${normalizeForMatch(fp.quote)}`) ?? "unclear";
      if (v === "valid_unannotated") validUnannot++;
      adjRows.push([rec.docId, fp.findingId, fp.category, csvEsc(fp.quote), v].join(","));
    }
    perDoc.push({
      docId: rec.docId,
      gold: gold.items.length,
      annotationStatus: gold.annotationStatus,
      proposed: rep.proposedCount,
      verified: rep.findings.length,
      rejected: rep.rejectedCount,
      tp: m.tp.length,
      fp: m.fp.length,
      fn: m.fn.length,
      ...s,
      hallucinationRate: rep.proposedCount ? rep.rejectedCount / rep.proposedCount : null,
      score: rep.score,
      llmSuggestedScore: rep.llmSuggestedScore,
      status: rep.status,
      fnItems: m.fn,
      fpItems: m.fp,
      unlocatedGold: m.unlocatedGold,
    });
  }
  const scored = perDoc.filter((d) => d.gold !== null) as { precision: number | null; recall: number | null; f1: number | null }[];
  const macro = (k: "precision" | "recall" | "f1") => {
    const v = scored.map((d) => d[k]).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const micro = prf(TP, FP, FN);
  const summary = {
    run: path.relative(ROOT, runDir),
    meta,
    documents: scored.length,
    micro,
    macro: { precision: macro("precision"), recall: macro("recall"), f1: macro("f1") },
    adjustedPrecision: TP + FP ? (TP + validUnannot) / (TP + FP) : null,
    preVerificationHallucinationRate: proposed ? rejected / proposed : null,
    postVerificationGrounding: { verified: verifiedAll, violations: groundingViolations, invariantHolds: groundingViolations === 0 },
    severityAgreement: TP ? sevAgree / TP : null,
    categoryRecall: Object.fromEntries(Object.entries(catHit).map(([k, v]) => [k, v.total ? v.hit / v.total : null])),
    statusDistribution: statusDist,
    repeatsF1,
    totals: { latencyMs: latency, inputTokens: inTok, outputTokens: outTok },
    perDoc,
  };

  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(adjFile, adjRows.join("\n") + "\n");
  writeJson(path.join(resultsDir, "report.json"), summary);
  const md = renderMarkdown(summary);
  fs.writeFileSync(path.join(resultsDir, "report.md"), md);
  if (opts.writeDocs !== false) fs.writeFileSync(path.join(ROOT, "docs/EVAL_REPORT.md"), md);
  return summary;
}

type Summary = Awaited<ReturnType<typeof scoreRun>>;

export function renderMarkdown(s: Summary, adversarialMd = ""): string {
  const L: string[] = [];
  L.push("# Değerlendirme Raporu (Eval)", "");
  if (s.meta.synthetic)
    L.push(
      "> **⚠️ SENTETİK ÇALIŞMA.** Bu sonuçlar kurgusal dokümanlar ve *simüle model* çıktılarıyla üretilmiştir; gerçek bir LLM'in performansını göstermez. Amaç, ölçüm hattının ve doğrulama katmanının uçtan uca çalıştığını göstermektir. Gerçek sonuçlar için README'deki \"gerçek sağlayıcı ile eval\" adımlarını izleyin.",
      "",
    );
  L.push(
    "> **Gold etiketler LLM destekli taslaktır; insan incelemesinden geçmeden kesin metrik değildir (annotation bias riski).** Tek annotator, küçük n; sitelerin metni zamanla değişebilir; model çıktıları deterministik değildir.",
    "",
  );
  L.push(`- Çalışma: \`${s.run}\` — sağlayıcı/model: ${s.meta.provider}/${s.meta.model}, prompt ${s.meta.promptVersion}, tekrar: ${s.meta.repeats}`);
  L.push(`- Etiket: ${s.meta.label}`, "");
  L.push("## Doküman bazında", "");
  L.push("| Doküman | Gold | Önerilen | Doğrulanan | Reddedilen | TP | FP | FN | Precision | Recall | F1 | Skor | Durum |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const d of s.perDoc as Record<string, unknown>[]) {
    if (d.gold === null) {
      L.push(`| ${d.docId} | — | | | | | | | | | | ${d.score} | ${STATUS_LABEL_TR[d.status as keyof typeof STATUS_LABEL_TR]} |`);
      continue;
    }
    L.push(
      `| ${d.docId} | ${d.gold} | ${d.proposed} | ${d.verified} | ${d.rejected} | ${d.tp} | ${d.fp} | ${d.fn} | ${fmtPct(d.precision as number)} | ${fmtPct(d.recall as number)} | ${fmtPct(d.f1 as number)} | ${d.score} | ${STATUS_LABEL_TR[d.status as keyof typeof STATUS_LABEL_TR]} |`,
    );
  }
  L.push("", "## Toplam", "");
  L.push("| Metrik | Değer |", "|---|---|");
  L.push(`| Micro Precision / Recall / F1 | ${fmtPct(s.micro.precision)} / ${fmtPct(s.micro.recall)} / ${fmtPct(s.micro.f1)} |`);
  L.push(`| Macro Precision / Recall / F1 | ${fmtPct(s.macro.precision)} / ${fmtPct(s.macro.recall)} / ${fmtPct(s.macro.f1)} |`);
  L.push(`| Adjudication sonrası precision (valid_unannotated sayılır) | ${fmtPct(s.adjustedPrecision)} |`);
  L.push(`| Doğrulama öncesi halüsinasyon oranı (reddedilen / önerilen) | ${fmtPct(s.preVerificationHallucinationRate)} |`);
  L.push(
    `| Doğrulama sonrası grounding (invariant testi) | ${s.postVerificationGrounding.invariantHolds ? "✓" : "✗"} ${s.postVerificationGrounding.verified} doğrulanmış alıntının ${s.postVerificationGrounding.violations} tanesi metinde yok |`,
  );
  L.push(`| Severity uyumu (TP'lerde) | ${fmtPct(s.severityAgreement)} |`);
  L.push(`| Durum dağılımı | ${Object.entries(s.statusDistribution).map(([k, v]) => `${STATUS_LABEL_TR[k as keyof typeof STATUS_LABEL_TR]}: ${v}`).join(", ")} |`);
  L.push(`| Süre / token (girdi, çıktı) | ${(s.totals.latencyMs / 1000).toFixed(1)} sn / ${s.totals.inputTokens}, ${s.totals.outputTokens} |`);
  L.push("", "### Kategori bazında recall", "", "| Kategori | Recall |", "|---|---|");
  for (const [k, v] of Object.entries(s.categoryRecall)) L.push(`| ${k} | ${fmtPct(v)} |`);
  L.push("", "### Kaçırılan gold maddeleri (FN)", "");
  for (const d of s.perDoc as { docId: string; fnItems?: { goldId: string; category: string; anchorQuote: string }[] }[])
    for (const fn of d.fnItems ?? []) L.push(`- ${d.docId} ${fn.goldId} (${fn.category}): "${fn.anchorQuote}"`);
  L.push("", "### FP adjudication", "", "Her FP `eval/results/adjudication.csv` dosyasına `unclear` olarak yazılır; `true_fp` / `valid_unannotated` olarak işaretleyip `eval:score`'u tekrar çalıştırın (işaretler korunur).", "");
  if (adversarialMd) L.push(adversarialMd);
  return L.join("\n") + "\n";
}

if (isMain(import.meta.url)) {
  const a = parseArgs();
  const run = typeof a.run === "string" ? path.resolve(a.run) : null;
  if (!run) {
    console.error("Kullanım: npm run eval:score -- --run eval/runs/<run>");
    process.exit(1);
  }
  scoreRun(run).then((s) => {
    console.log(`micro P/R/F1: ${fmtPct(s.micro.precision)} / ${fmtPct(s.micro.recall)} / ${fmtPct(s.micro.f1)} → eval/results/report.md, docs/EVAL_REPORT.md`);
  });
}
