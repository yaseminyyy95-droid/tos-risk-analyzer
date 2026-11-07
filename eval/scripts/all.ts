// Tüm eval hattı: (korpus yoksa sentetik korpus) → gold doğrulama → run/replay → score → adversarial → rapor.
//   Anahtarsız:  npm run eval:all -- --provider mock --replay eval/runs/example-synthetic
//   Gerçek:      OPENAI_API_KEY=... npm run eval:all -- --provider openai --model <MODEL_ADI> --repeats 1
import fs from "node:fs";
import path from "node:path";
import { P, ROOT, fmtPct, listCorpus, parseArgs } from "./lib";
import { runFetch } from "./fetch";
import { validateGold } from "./validate-gold";
import { optionsFromArgs, runEval } from "./run";
import { renderMarkdown, scoreRun } from "./score";
import { runAdversarial } from "./adversarial";

async function main() {
  const args = parseArgs();
  if (!listCorpus().length) {
    console.log("Korpus boş → sentetik korpus oluşturuluyor (ağ kullanılmaz)");
    await runFetch({ synthetic: true });
  }
  const g = validateGold();
  console.log(g.lines.join("\n"));
  if (!g.ok) process.exit(1);

  const o = optionsFromArgs({ ...args, out: typeof args.out === "string" ? args.out : path.join(P.runs, "_last") });
  console.log(`\n[run] ${o.provider}/${o.model}${o.replay ? ` (replay: ${path.relative(ROOT, o.replay)})` : ""}`);
  await runEval(o);

  console.log("\n[score]");
  const summary = await scoreRun(o.out, { writeDocs: false });
  console.log(`micro P/R/F1: ${fmtPct(summary.micro.precision)} / ${fmtPct(summary.micro.recall)} / ${fmtPct(summary.micro.f1)}`);

  console.log("\n[adversarial]");
  const adv = await runAdversarial({ provider: o.provider, model: o.model, replay: o.replay });
  for (const p of adv.result.byProfile)
    console.log(`  ${p.profile}: ASR ${fmtPct(p.attackSuccessRate)}, tespit ${fmtPct(p.detectionRate)}, Jaccard ${p.meanJaccard.toFixed(2)}`);

  const md = renderMarkdown(summary, adv.md);
  fs.writeFileSync(path.join(P.results, "report.md"), md);
  fs.writeFileSync(path.join(ROOT, "docs/EVAL_REPORT.md"), md);
  console.log("\n✓ eval/results/report.md, eval/results/report.json, eval/results/adversarial.json, docs/EVAL_REPORT.md");
}

main().catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
