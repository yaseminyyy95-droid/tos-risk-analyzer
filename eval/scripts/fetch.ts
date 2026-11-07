// Korpus oluşturma: gerçek ToS sayfalarını Playwright ile açar, uzantının extractor.ts kodunu sayfaya
// enjekte eder ve eval/corpus/<id>.json yazar. Ağ yoksa: --from-raw (eval/raw/<id>.html, ağ kullanmaz).
// Kullanım (kendi makinenizde):
//   npm run eval:fetch                      # manifest'teki gerçek dokümanlar (ağ gerekir)
//   npm run eval:fetch -- --from-raw        # eval/raw/<id>.html dosyalarından (ağsız)
//   npm run eval:fetch -- --synthetic       # eval/synthetic/*.html (ağsız, anahtarsız)
//   npm run eval:fetch -- --only zoom-tos
import fs from "node:fs";
import path from "node:path";
import {
  P,
  ROOT,
  extractHtml,
  gitSha,
  isMain,
  loadPlaywright,
  parseArgs,
  readJson,
  runExtractorInPage,
  textHash,
  writeJson,
  type CorpusEntry,
  type EvalPage,
  type Manifest,
  type ManifestEntry,
} from "./lib";
import type { ExtractedDocument } from "../../src/core/types";

const COOKIE_BUTTONS = /^(accept( all)?( cookies)?|i agree|agree|allow all|got it|ok|kabul et|tümünü kabul et)$/i;

async function fetchLive(entry: ManifestEntry): Promise<ExtractedDocument> {
  const pw = loadPlaywright();
  if (!pw) throw new Error("Playwright bulunamadı");
  const browser = await pw.chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = (await ctx.newPage()) as unknown as EvalPage;
    const res = await page.goto(entry.url!, { waitUntil: "networkidle", timeout: 60000 });
    if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status() ?? "?"}`);
    try {
      await page.getByRole("button", { name: COOKIE_BUTTONS }).first().click({ timeout: 3000 });
      await page.waitForTimeout(800);
    } catch {
      /* çerez bannerı yok */
    }
    return await runExtractorInPage(page, entry.url!);
  } finally {
    await browser.close();
  }
}

async function writeCorpus(entry: ManifestEntry, doc: ExtractedDocument, env: "chromium" | "jsdom", synthetic: boolean, file: string | null) {
  const sha = await textHash(doc);
  const ex = `content/extractor@${gitSha()}`;
  const now = new Date().toISOString();
  const c: CorpusEntry = {
    id: entry.id,
    company: entry.company,
    docType: entry.docType,
    synthetic,
    source: { url: entry.url, file },
    retrievedAt: now,
    sha256: sha,
    extractor: ex,
    extractorEnv: env,
    doc,
  };
  writeJson(path.join(P.corpus, `${entry.id}.json`), c);
  Object.assign(entry, { retrievedAt: now, sha256: sha, extractor: ex });
  if (!synthetic) entry.status = "fetched";
  console.log(`✓ ${entry.id}: ${doc.blocks.length} blok, ${doc.stats.visibleChars} karakter, ${doc.quarantined.length} karantina [${env}]`);
}

export async function runFetch(args = parseArgs()): Promise<number> {
  const manifest = readJson<Manifest>(P.manifest);
  const only = typeof args.only === "string" ? args.only : null;
  let failures = 0;
  if (args.synthetic) {
    for (const e of manifest.synthetic) {
      if (only && e.id !== only) continue;
      const html = fs.readFileSync(path.join(ROOT, e.file!), "utf8");
      const { doc, env } = await extractHtml(html, `https://synthetic.example/legal/${e.id}`);
      await writeCorpus(e, doc, env, true, e.file!);
    }
  } else {
    for (const e of manifest.documents) {
      if (only && e.id !== only) continue;
      const rawFile = path.join(P.raw, `${e.id}.html`);
      try {
        if (args["from-raw"]) {
          if (!fs.existsSync(rawFile)) throw new Error(`${path.relative(ROOT, rawFile)} yok`);
          const { doc, env } = await extractHtml(fs.readFileSync(rawFile, "utf8"), e.url!);
          await writeCorpus(e, doc, env, false, path.relative(ROOT, rawFile));
        } else {
          await writeCorpus(e, await fetchLive(e), "chromium", false, null);
        }
      } catch (err) {
        failures++;
        e.status = "fetch_failed";
        console.error(`✗ ${e.id}: ${(err as Error).message.split("\n")[0]}`);
        console.error(
          `  → Sayfayı tarayıcıda açıp "Farklı kaydet (yalnızca HTML)" ile ${path.relative(ROOT, rawFile)} olarak kaydedin, sonra: npm run eval:fetch -- --from-raw --only ${e.id}`,
        );
      }
    }
  }
  writeJson(P.manifest, manifest);
  return failures;
}

if (isMain(import.meta.url)) {
  runFetch().then((f) => process.exit(f ? 1 : 0));
}
