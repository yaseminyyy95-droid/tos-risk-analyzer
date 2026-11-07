// Smoke: dist/ paketlenmemiş uzantı olarak Chromium'a yüklenir; SW ayağa kalkar, side panel / options sayfası açılır.
// Sistemdeki global Playwright kullanılır (yeni bağımlılık yok).
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { URL } from "node:url";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [
    "playwright",
    ...(process.env.NODE_PATH || "").split(":").filter(Boolean).map((p) => path.join(p, "playwright")),
    "/opt/node22/lib/node_modules/playwright",
    "/opt/node-tools/node_modules/playwright",
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* sıradaki */
    }
  }
  throw new Error("Playwright bulunamadı (sistem kurulumu bekleniyor).");
}
const { chromium } = loadPlaywright();

const dist = path.resolve("dist");
if (!fs.existsSync(path.join(dist, "manifest.json"))) {
  console.error("dist/manifest.json yok — önce npm run build");
  process.exit(1);
}
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "tos-smoke-"));
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: true,
  channel: "chromium",
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let fail = false;
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log("✓ Service worker çalışıyor:", sw.url());
  for (const p of ["src/ui/sidepanel/index.html", "src/ui/options/index.html", "src/ui/popup/index.html"]) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`chrome-extension://${extId}/${p}`);
    await page.waitForSelector("#app *", { timeout: 10000 });
    const disclaimer = await page.locator('[data-cy="legal-disclaimer"]').count();
    console.log(`${errors.length ? "✗" : "✓"} ${p} açıldı (disclaimer: ${disclaimer})`);
    if (errors.length) {
      console.error(errors);
      fail = true;
    }
    if (process.env.SMOKE_REQUIRE_DISCLAIMER && disclaimer < 1) fail = true;
  }
} catch (e) {
  console.error(e);
  fail = true;
} finally {
  await ctx.close();
}
process.exit(fail ? 1 : 0);
