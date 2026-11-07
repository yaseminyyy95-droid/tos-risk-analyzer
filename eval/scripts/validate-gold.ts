// Gold etiketlerin anchorQuote'larının korpus kanonik metninde (normalize eşleşmeyle) birebir geçtiğini doğrular.
import fs from "node:fs";
import path from "node:path";
import { P, isMain, listCorpus, readJson } from "./lib";
import { canonicalTextOf } from "../../src/core/pipeline";
import { normalizeForMatch } from "../../src/core/normalize";
import { RISK_CATEGORIES, SEVERITIES } from "../../src/core/categories";

export interface GoldItem {
  goldId: string;
  category: string;
  severity: string;
  anchorQuote: string;
  acceptableCategories: string[];
}
export interface GoldFile {
  docId: string;
  annotationStatus: "draft" | "reviewed";
  annotator: string;
  synthetic?: boolean;
  items: GoldItem[];
}

export function loadGold(docId: string): GoldFile | null {
  const p = path.join(P.gold, `${docId}.json`);
  return fs.existsSync(p) ? readJson<GoldFile>(p) : null;
}

export function validateGold(): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const corpus = new Map(listCorpus().map((c) => [c.id, c]));
  const files = fs.existsSync(P.gold) ? fs.readdirSync(P.gold).filter((f) => f.endsWith(".json")) : [];
  for (const f of files) {
    const g = readJson<GoldFile>(path.join(P.gold, f));
    const c = corpus.get(g.docId);
    if (!c) {
      ok = false;
      lines.push(`✗ ${g.docId}: korpus kaydı yok (önce npm run eval:fetch)`);
      continue;
    }
    const text = normalizeForMatch(canonicalTextOf(c.doc));
    const bad: string[] = [];
    for (const it of g.items) {
      if (!(RISK_CATEGORIES as readonly string[]).includes(it.category)) bad.push(`${it.goldId}: geçersiz kategori ${it.category}`);
      if (!(SEVERITIES as readonly string[]).includes(it.severity)) bad.push(`${it.goldId}: geçersiz severity ${it.severity}`);
      if (!it.acceptableCategories.includes(it.category)) bad.push(`${it.goldId}: acceptableCategories kendi kategorisini içermiyor`);
      if (!text.includes(normalizeForMatch(it.anchorQuote))) bad.push(`${it.goldId}: anchorQuote metinde yok: "${it.anchorQuote.slice(0, 60)}"`);
    }
    if (g.items.length < 6 || g.items.length > 15) bad.push(`madde sayısı ${g.items.length} (beklenen 6–15)`);
    if (bad.length) {
      ok = false;
      lines.push(`✗ ${g.docId} (${g.annotationStatus}):`, ...bad.map((b) => `    ${b}`));
    } else lines.push(`✓ ${g.docId}: ${g.items.length} madde, tüm anchorQuote'lar metinde birebir geçiyor (${g.annotationStatus})`);
  }
  return { ok, lines };
}

if (isMain(import.meta.url)) {
  const r = validateGold();
  console.log(r.lines.join("\n"));
  process.exit(r.ok ? 0 : 1);
}
