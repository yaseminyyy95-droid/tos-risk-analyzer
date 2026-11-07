// Eval betiklerinin ortak yardımcıları. src/core ve src/content kodu doğrudan import edilir.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import type { ExtractedDocument } from "../../src/core/types";
import { canonicalTextOf } from "../../src/core/pipeline";
import { sha256Hex } from "../../src/core/hash";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const EVAL = path.join(ROOT, "eval");
export const P = {
  manifest: path.join(EVAL, "corpus.manifest.json"),
  corpus: path.join(EVAL, "corpus"),
  gold: path.join(EVAL, "gold"),
  raw: path.join(EVAL, "raw"),
  synthetic: path.join(EVAL, "synthetic"),
  runs: path.join(EVAL, "runs"),
  results: path.join(EVAL, "results"),
};

export interface ManifestEntry {
  id: string;
  company: string;
  docType: string;
  url: string | null;
  retrievedAt: string | null;
  sha256: string | null;
  extractor: string | null;
  synthetic?: boolean;
  file?: string;
  status?: string;
}
export interface Manifest {
  notice: string;
  documents: ManifestEntry[];
  synthetic: ManifestEntry[];
}

export interface CorpusEntry {
  id: string;
  company: string;
  docType: string;
  synthetic: boolean;
  source: { url: string | null; file: string | null };
  retrievedAt: string;
  sha256: string;
  extractor: string;
  extractorEnv: "chromium" | "jsdom";
  doc: ExtractedDocument;
}

export const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, "utf8")) as T;
export function writeJson(p: string, data: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

export function parseArgs(argv = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) out[k!] = v;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) out[k!] = argv[++i]!;
    else out[k!] = true;
  }
  return out;
}

export function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

export function listCorpus(): CorpusEntry[] {
  if (!fs.existsSync(P.corpus)) return [];
  return fs
    .readdirSync(P.corpus)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson<CorpusEntry>(path.join(P.corpus, f)));
}

export function loadPlaywright(): typeof import("playwright") | null {
  const require = createRequire(import.meta.url);
  const c = [
    "playwright",
    ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean).map((p) => path.join(p, "playwright")),
    "/opt/node22/lib/node_modules/playwright",
    "/opt/node-tools/node_modules/playwright",
  ];
  for (const x of c) {
    try {
      return require(x);
    } catch {
      /* sıradaki */
    }
  }
  return null;
}

/** src/content/extractor.ts'i sayfaya enjekte edilebilir tek bir IIFE olarak paketler (uzantıdaki kodun aynısı). */
export async function bundleExtractor(): Promise<string> {
  const esbuild = await import("esbuild");
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/content/extractor.ts")],
    bundle: true,
    format: "iife",
    globalName: "TosExtractor",
    write: false,
    target: "es2022",
  });
  return r.outputFiles[0]!.text;
}

/** Playwright sayfasının eval betiklerinde kullanılan alt kümesi. */
export interface EvalPage {
  setContent(h: string, o?: object): Promise<void>;
  goto(u: string, o: object): Promise<{ status(): number } | null>;
  getByRole(r: string, o: object): { first(): { click(o: object): Promise<void> } };
  waitForTimeout(ms: number): Promise<void>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  evaluate<R, A>(fn: (a: A) => R, a: A): Promise<R>;
}

export async function runExtractorInPage(page: EvalPage, url: string): Promise<ExtractedDocument> {
  await page.addScriptTag({ content: await bundleExtractor() });
  return (await page.evaluate(
    (u: string) =>
      (globalThis as unknown as { TosExtractor: { extractDocument: (d: Document, o: { url: string }) => unknown } }).TosExtractor.extractDocument(document, { url: u }),
    url,
  )) as ExtractedDocument;
}

/** HTML → ExtractedDocument. Varsayılan: gerçek Chromium (computed style ile; ağ kullanmaz); yoksa jsdom. */
export async function extractHtml(html: string, url: string): Promise<{ doc: ExtractedDocument; env: "chromium" | "jsdom" }> {
  const pw = loadPlaywright();
  if (pw) {
    const browser = await pw.chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = (await ctx.newPage()) as unknown as EvalPage;
      await page.setContent(html, { waitUntil: "load" });
      return { doc: await runExtractorInPage(page, url), env: "chromium" };
    } finally {
      await browser.close();
    }
  }
  const { JSDOM } = await import("jsdom");
  const { extractDocument } = await import("../../src/content/extractor");
  const dom = new JSDOM(html, { url });
  return { doc: extractDocument(dom.window.document, { url }), env: "jsdom" };
}

export async function textHash(doc: ExtractedDocument): Promise<string> {
  return sha256Hex(canonicalTextOf(doc));
}

export const fmtPct = (x: number | null) => (x === null || Number.isNaN(x) ? "—" : `${(x * 100).toFixed(1)}%`);

export const isMain = (metaUrl: string) => metaUrl === `file://${process.argv[1]}`;
