import type { VerifiedReport } from "../core/schema";
import { CATEGORY_INFO, SEVERITY_TR } from "../core/categories";
import { STATUS_LABEL_TR } from "../core/status";

/** Dışa aktarılan JSON: yalnızca VerifiedReport (API anahtarı içermez) + disclaimer en üstte. */
export function reportToJson(report: VerifiedReport): string {
  const { disclaimer_tr, ...rest } = report;
  return JSON.stringify({ disclaimer_tr, ...rest }, null, 2);
}

const mdEscape = (s: string) => s.replace(/([\\`*_[\]<>#|])/g, "\\$1").replace(/\n/g, " ");

export function reportToMarkdown(report: VerifiedReport): string {
  const L: string[] = [];
  L.push(`> ⚖️ **${report.disclaimer_tr}**`, "");
  L.push(`# Risk raporu: ${mdEscape(report.title || report.host)}`, "");
  L.push(`- Kaynak: ${mdEscape(report.url)}`);
  L.push(`- Durum: **${STATUS_LABEL_TR[report.status]}**`);
  L.push(`- Skor: **${report.score} / 100 (${report.level})** — yalnızca doğrulanmış alıntılardan hesaplanır`);
  if (report.llmSuggestedScore !== null) L.push(`- Modelin önerdiği skor (tanısal): ${report.llmSuggestedScore}`);
  L.push(`- Sağlayıcı / model: ${mdEscape(report.provider)} / ${mdEscape(report.model)} · prompt ${report.promptVersion}`);
  L.push(`- Tarih: ${report.createdAt} · metin SHA-256: \`${report.textSha256}\``, "");
  L.push("## Durum gerekçeleri", ...report.statusReasons_tr.map((r) => `- ${mdEscape(r)}`), "");
  if (report.summary_tr) L.push("## Özet", mdEscape(report.summary_tr), "");
  L.push(`## Bulgular (${report.findings.length})`, "");
  for (const f of report.findings) {
    L.push(`### [${SEVERITY_TR[f.severity]}] ${mdEscape(f.title_tr)}`);
    L.push(`*${CATEGORY_INFO[f.category].label_tr}* — ${mdEscape(f.explanation_tr)}`, "");
    L.push(`> ${mdEscape(f.quote)}`, "");
  }
  L.push(
    report.rejectedCount === 0
      ? "Tüm iddialar doğrulandı."
      : `${report.rejectedCount} iddia, orijinal metinde birebir doğrulanamadığı için rapordan çıkarıldı.`,
    "",
  );
  if (report.injection.heuristicFlaggedSegments.length || report.injection.hiddenBlocksWithInstructions || report.injection.llmSuspected)
    L.push("## ⚠️ Prompt injection uyarısı", `Gizli blok: ${report.injection.hiddenBlocksRemoved} (talimat içeren: ${report.injection.hiddenBlocksWithInstructions}); işaretlenen bölüm: ${report.injection.heuristicFlaggedSegments.length}.`, "");
  if (report.sentinelHints.length) {
    L.push("## Doğrulanmamış ipuçları — manuel inceleyin");
    for (const h of report.sentinelHints) L.push(`- ${CATEGORY_INFO[h.category].label_tr}: ${mdEscape(h.matchedText)}`);
    L.push("");
  }
  if (report.uncertaintyNotes_tr) L.push("## Belirsizlik notları", mdEscape(report.uncertaintyNotes_tr), "");
  L.push("---", `_${report.disclaimer_tr}_`);
  return L.join("\n");
}

export function downloadText(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
