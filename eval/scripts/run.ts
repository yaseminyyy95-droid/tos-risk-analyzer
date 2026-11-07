// Korpustaki her doküman için analyzeDocument çalıştırır; ham LLM yanıtlarını, VerifiedReport'u ve
// zamanlama/token kullanımını kaydeder.
//   Gerçek:  OPENAI_API_KEY=... npm run eval:run -- --provider openai --model gpt-4.1 --repeats 1
//   Replay:  npm run eval:run -- --provider mock --replay eval/runs/example-synthetic   (anahtarsız)
//   Örnek:   npm run eval:run -- --provider mock --simulate --out eval/runs/example-synthetic
import fs from "node:fs";
import path from "node:path";
import { analyzeDocument } from "../../src/core/pipeline";
import { createProvider, MockProvider, type LLMProvider, type LLMProviderId } from "../../src/core/providers";
import { DEFAULT_MODELS } from "../../src/core/providers/models";
import { PROMPT_VERSION } from "../../src/core/prompt";
import { P, ROOT, isMain, listCorpus, parseArgs, readJson, writeJson, type CorpusEntry } from "./lib";
import { simulatedResponder } from "./simulated-model";

const KEY_ENV: Record<string, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", groq: "GROQ_API_KEY" };

export interface RunOptions {
  provider: LLMProviderId;
  model: string;
  repeats: number;
  out: string;
  replay?: string;
  simulate?: boolean;
  docs?: string[];
}

export interface RunMeta {
  provider: string;
  model: string;
  repeats: number;
  promptVersion: string;
  createdAt: string;
  synthetic: boolean;
  label: string;
  replayOf: string | null;
  docs: string[];
}

export interface DocRunRecord {
  docId: string;
  repeat: number;
  report: import("../../src/core/schema").VerifiedReport;
  canonicalText: string;
  findingSpans: { id: string; start: number; end: number }[];
  segments: { id: string; charStart: number; charEnd: number }[];
  rejected: { reason: string; category: string; quote: string }[];
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

/** Replay: eval/runs/<run>/raw/<doc>.r<k>.c<chunk>.a<attempt>.txt dosyalarını çağrı sırasıyla döndürür. */
export function replayResponder(dir: string, docId: string, repeat: number) {
  const rawDir = path.join(dir, "raw");
  const files = fs.existsSync(rawDir)
    ? fs
        .readdirSync(rawDir)
        .filter((f) => f.startsWith(`${docId}.r${repeat}.`) || (repeat > 1 && f.startsWith(`${docId}.r1.`)))
        .filter((f, _i, arr) => (arr.some((x) => x.startsWith(`${docId}.r${repeat}.`)) ? f.startsWith(`${docId}.r${repeat}.`) : true))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    : [];
  if (!files.length) throw new Error(`Replay kaydı yok: ${path.relative(ROOT, rawDir)}/${docId}.r${repeat}.*`);
  return (_req: unknown, i: number) => {
    const f = files[i];
    if (!f) throw new Error(`Replay: ${docId} için ${i + 1}. çağrının kaydı yok`);
    return fs.readFileSync(path.join(rawDir, f), "utf8");
  };
}

function providerFor(o: RunOptions, doc: CorpusEntry, repeat: number): LLMProvider {
  if (o.provider === "mock") {
    if (o.replay) return new MockProvider(replayResponder(o.replay, doc.id, repeat));
    if (o.simulate) return new MockProvider(simulatedResponder(doc.id));
    throw new Error("mock sağlayıcı için --replay <dir> veya --simulate gerekir");
  }
  const key = process.env[KEY_ENV[o.provider]!];
  if (!key) throw new Error(`${KEY_ENV[o.provider]} ortam değişkeni tanımlı değil`);
  return createProvider(o.provider, key);
}

export async function runEval(o: RunOptions): Promise<RunMeta> {
  const corpus = listCorpus().filter((c) => !o.docs || o.docs.includes(c.id));
  if (!corpus.length) throw new Error("Korpus boş — önce: npm run eval:fetch -- --synthetic (veya gerçek dokümanlar)");
  const replayMeta = o.replay && fs.existsSync(path.join(o.replay, "meta.json")) ? readJson<RunMeta>(path.join(o.replay, "meta.json")) : null;
  const synthetic = Boolean(o.simulate || replayMeta?.synthetic || corpus.every((c) => c.synthetic));
  fs.rmSync(o.out, { recursive: true, force: true });
  for (const doc of corpus) {
    for (let r = 1; r <= o.repeats; r++) {
      const provider = providerFor(o, doc, r);
      const t0 = Date.now();
      const { report, diagnostics } = await analyzeDocument(doc.doc, provider, { model: o.model });
      for (const raw of diagnostics.rawResponses) {
        const f = path.join(o.out, "raw", `${doc.id}.r${r}.c${raw.chunk}.a${raw.attempt}.txt`);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, raw.raw);
      }
      const usage = diagnostics.rawResponses.reduce(
        (a, x) => ({ inputTokens: a.inputTokens + (x.usage?.inputTokens ?? 0), outputTokens: a.outputTokens + (x.usage?.outputTokens ?? 0) }),
        { inputTokens: 0, outputTokens: 0 },
      );
      const rec: DocRunRecord = {
        docId: doc.id,
        repeat: r,
        report,
        canonicalText: diagnostics.canonicalText,
        findingSpans: diagnostics.findingSpans,
        segments: diagnostics.segments.map((s) => ({ id: s.id, charStart: s.charStart, charEnd: s.charEnd })),
        rejected: diagnostics.rejected.map((x) => ({ reason: x.reason, category: x.finding.category, quote: x.finding.quote })),
        usage,
        latencyMs: Date.now() - t0,
      };
      writeJson(path.join(o.out, "reports", `${doc.id}.r${r}.json`), rec);
      console.log(
        `  ${doc.id} r${r}: ${report.status}, skor ${report.score}, ${report.findings.length} doğrulanmış / ${report.proposedCount} önerilen, ${report.rejectedCount} reddedilen`,
      );
    }
  }
  const meta: RunMeta = {
    provider: o.provider,
    model: o.model,
    repeats: o.repeats,
    promptVersion: PROMPT_VERSION,
    createdAt: new Date().toISOString(),
    synthetic,
    label: synthetic ? "SENTETİK — simüle model çıktısı; gerçek bir LLM performansını göstermez" : "Gerçek sağlayıcı çalışması",
    replayOf: o.replay ? path.relative(ROOT, o.replay) : null,
    docs: corpus.map((c) => c.id),
  };
  writeJson(path.join(o.out, "meta.json"), meta);
  return meta;
}

export function optionsFromArgs(a = parseArgs()): RunOptions {
  const provider = (typeof a.provider === "string" ? a.provider : "mock") as LLMProviderId;
  const model = typeof a.model === "string" ? a.model : provider === "mock" ? (a.simulate ? "simulated-model" : "mock-replay") : DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    provider,
    model,
    repeats: Math.min(3, Math.max(1, Number(a.repeats ?? 1))),
    out: path.resolve(typeof a.out === "string" ? a.out : path.join(P.runs, stamp)),
    replay: typeof a.replay === "string" ? path.resolve(a.replay) : undefined,
    simulate: Boolean(a.simulate),
    docs: typeof a.docs === "string" ? a.docs.split(",") : undefined,
  };
}

if (isMain(import.meta.url)) {
  const o = optionsFromArgs();
  console.log(`eval:run → ${path.relative(ROOT, o.out)} (${o.provider}/${o.model}, tekrar ${o.repeats})`);
  runEval(o).catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
