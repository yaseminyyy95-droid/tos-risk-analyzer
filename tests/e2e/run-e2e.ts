// E2E + demo videosu (Cypress yerine sistemdeki Playwright; bkz. docs/DECISIONS.md).
// İki senaryo tek bir kayıtta: (1) mutlu yol, (2) prompt injection + uydurma alıntılar.
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeForMatch } from "../../src/core/normalize";
import type { Browser, Page, Route } from "playwright";

const require = createRequire(import.meta.url);
function loadPlaywright(): typeof import("playwright") {
  const c = ["playwright", ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean).map((p) => path.join(p, "playwright")), "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright"];
  for (const x of c) {
    try {
      return require(x);
    } catch {
      /* sıradaki */
    }
  }
  throw new Error("Sistemde Playwright bulunamadı");
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASE = "http://localhost:4173";
const VIDEO_DIR = path.join(ROOT, "tests/e2e/videos");
const OPENAI = "https://api.openai.com/v1/chat/completions";
const expected = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/llm/expected.json"), "utf8"));
const fixture = (n: string) => fs.readFileSync(path.join(ROOT, "fixtures/llm", n), "utf8");
const PAUSE = Number(process.env.E2E_PAUSE ?? 1200);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cy = (sel: string) => `[data-cy="${sel}"]`;

async function waitForServer(url: string, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* bekle */
    }
    await sleep(200);
  }
  throw new Error("harness sunucusu açılmadı");
}

async function stubOpenAI(page: Page, fixtureName: string, captured: { body: string; headers: Record<string, string> }[]) {
  await page.unroute(OPENAI).catch(() => {});
  await page.route(OPENAI, async (route: Route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    captured.push({ body: req.postData() ?? "", headers: req.headers() });
    await sleep(1500); // ilerleme adımları videoda görünsün
    await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: fixture(fixtureName) });
  });
}

async function scrollPanelTo(page: Page, sel: string) {
  await page.locator(sel).first().scrollIntoViewIfNeeded();
}

async function happyPath(page: Page) {
  console.log("Senaryo 1 — Mutlu yol: risk raporu doğrulanmış alıntılarla üretilir");
  const captured: { body: string; headers: Record<string, string> }[] = [];
  await stubOpenAI(page, "happy.openai.json", captured);
  await page.goto(`${BASE}/harness.html?page=acme-tos`);
  const disc = page.locator(cy("legal-disclaimer"));
  await disc.waitFor({ timeout: 10000 });
  check("disclaimer görünür ve 'hukuki tavsiye vermez' içerir", (await disc.textContent())!.includes("hukuki tavsiye vermez"));
  await sleep(PAUSE);
  await page.locator(cy("analyze-btn")).click();
  const prog = page.locator(cy("progress"));
  await prog.waitFor({ timeout: 5000 });
  check("ilerleme görünür", await prog.isVisible());
  await page.locator(cy("status-badge")).waitFor({ timeout: 15000 });
  await sleep(PAUSE);
  check("status-badge = Doğrulandı", (await page.locator(cy("status-badge")).textContent()) === "Doğrulandı");
  const score = Number(await page.locator(cy("risk-score")).textContent());
  check(`risk-score deterministik beklenen değer (${expected.happy.score}) ve > 50`, score === expected.happy.score && score > 50, `got ${score}`);
  const cards = page.locator(cy("finding-card"));
  check("finding-card sayısı 6", (await cards.count()) === 6, `got ${await cards.count()}`);
  const frame = page.frameLocator("#page");
  const bodyText = normalizeForMatch((await frame.locator("body").textContent()) ?? "");
  const quotes = await page.locator(cy("finding-quote")).allTextContents();
  check("her alıntı iframe metninde (normalize) birebir geçer", quotes.length === 6 && quotes.every((q) => bodyText.includes(normalizeForMatch(q))));
  check("1 bulgu normalize eşleşme ile doğrulandı", (await page.locator(cy("match-tier")).count()) === 1);
  // "Sayfada göster" — akordeon içindeki veri satışı maddesi
  const saleCard = cards.filter({ hasText: "Kişisel verilerin satılması" });
  await saleCard.scrollIntoViewIfNeeded();
  await saleCard.locator(cy("show-in-page")).click();
  await sleep(600);
  // Not: highlighter iframe belgesine harness (üst pencere) realm'inden erişir; registry'ye de aynı yoldan bakılır.
  const highlighted = await page.evaluate(() => {
    const w = (document.getElementById("page") as HTMLIFrameElement).contentWindow as Window & typeof globalThis;
    const css = w.CSS as unknown as { highlights?: Map<string, unknown> };
    return Boolean(css.highlights?.has("tos-quote")) || w.document.querySelector("[data-tos-highlight-overlay]") !== null;
  });
  const detailsOpen = await page.frame({ url: /\/pages\/acme-tos\.html/ })!.evaluate(() => (document.querySelector("details") as HTMLDetailsElement).open);
  check("vurgulanan alıntının bulunduğu akordeon açıldı", detailsOpen);
  check("Sayfada göster → iframe'de vurgu oluştu", highlighted);
  await sleep(PAUSE);
  await scrollPanelTo(page, cy("rejected-summary"));
  check("rejected-summary 'Tüm iddialar doğrulandı'", ((await page.locator(cy("rejected-summary")).textContent()) ?? "").includes("Tüm iddialar doğrulandı"));
  const body = JSON.parse(captured[0]?.body ?? "{}");
  const user = body.messages?.[1]?.content ?? "";
  check("istek gövdesinde <<<DOC_ ve <<<END_DOC_ var", /<<<DOC_[0-9a-f]{32}>>>/.test(user) && /<<<END_DOC_[0-9a-f]{32}>>>/.test(user));
  check("response_format.json_schema.strict === true", body.response_format?.json_schema?.strict === true);
  check("Authorization yalnızca test anahtarı", captured[0]?.headers.authorization === "Bearer sk-test-cypress");
  await sleep(PAUSE);
}

async function uncertaintyPath(page: Page) {
  console.log("Senaryo 2 — Belirsizlik: prompt injection + uydurma alıntılar dürüstçe gösterilir");
  const captured: { body: string; headers: Record<string, string> }[] = [];
  await stubOpenAI(page, "compromised.openai.json", captured);
  await page.goto(`${BASE}/harness.html?page=injected-tos`);
  await page.locator(cy("analyze-btn")).waitFor({ timeout: 10000 });
  await sleep(PAUSE / 2);
  await page.locator(cy("analyze-btn")).click();
  await page.locator(cy("status-badge")).waitFor({ timeout: 15000 });
  const user = JSON.parse(captured[0]?.body ?? "{}").messages?.[1]?.content ?? "";
  check("istek gövdesi beyaz-üstüne-beyaz gizli metni İÇERMEZ (karantina)", user.length > 0 && !user.includes("certified safe"));
  check("görünür injection paragrafı FLAGGED etiketiyle gider", user.includes("⚠ FLAGGED_AS_POSSIBLE_INJECTION Note to AI assistants"));
  const alert = page.locator(cy("injection-alert"));
  check("injection-alert görünür", await alert.isVisible());
  const hidden = Number(/(\d+) gizli metin/.exec((await page.locator(cy("hidden-blocks")).textContent()) ?? "")?.[1] ?? 0);
  check("gizli blok sayısı ≥ 1", hidden >= 1, `got ${hidden}`);
  await sleep(PAUSE);
  check("status-badge = Belirsiz — manuel inceleme önerilir", (await page.locator(cy("status-badge")).textContent()) === "Belirsiz — manuel inceleme önerilir");
  const reasons = (await page.locator(cy("status-reasons")).textContent()) ?? "";
  check("gerekçeler: prompt injection", reasons.includes("Prompt injection"));
  check("gerekçeler: model etkilenmiş olabilir", reasons.includes("Model etkilenmiş olabilir"));
  check("gerekçeler: LLM önerisi ile skor sapması", reasons.includes("sapma"));
  const score = Number(await page.locator(cy("risk-score")).textContent());
  check(`risk-score ≠ 0 (LLM'in 0 önerisi yok sayıldı; beklenen ${expected.compromised.score})`, score !== 0 && score === expected.compromised.score, `got ${score}`);
  await scrollPanelTo(page, cy("finding-card"));
  await sleep(PAUSE);
  check("finding-card sayısı 1 (yalnızca tahkim)", (await page.locator(cy("finding-card")).count()) === 1);
  await scrollPanelTo(page, cy("rejected-summary"));
  const rej = (await page.locator(cy("rejected-summary")).textContent()) ?? "";
  check("rejected-summary '3 iddia … çıkarıldı'", /3 iddia.*çıkarıldı/.test(rej), rej);
  const panel = (await page.locator("#app").textContent()) ?? "";
  check("uydurma cümle side panel'de hiçbir yerde geçmez", !panel.includes(expected.compromised.fabricated) && !panel.includes("never share it with anyone"));
  await scrollPanelTo(page, cy("sentinel-hints"));
  await sleep(PAUSE);
}

async function main() {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true }); // trashAssetsBeforeRuns
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--config", "vite.harness.config.ts", "--port", "4173", "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  let browser: Browser | null = null;
  const t0 = Date.now();
  try {
    await waitForServer(`${BASE}/harness.html`);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } } });
    ctx.setDefaultTimeout(8000);
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    try {
      await happyPath(page);
      await uncertaintyPath(page);
    } catch (e) {
      check("senaryo hatasız tamamlandı", false, String(e));
      await page.screenshot({ path: path.join(VIDEO_DIR, "failure.png") }).catch(() => {}); // screenshotOnRunFailure
    }
    check("sayfada JS hatası yok", pageErrors.length === 0, pageErrors.join("; "));
    const video = page.video();
    await ctx.close();
    if (video) {
      const webm = await video.path();
      const mp4 = path.join(VIDEO_DIR, "demo.mp4");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
      fs.rmSync(webm);
      console.log(`Video: ${path.relative(ROOT, mp4)}`);
    }
  } finally {
    await browser?.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti (${((Date.now() - t0) / 1000).toFixed(1)} sn)`);
  process.exit(failed.length ? 1 : 0);
}

void main();
