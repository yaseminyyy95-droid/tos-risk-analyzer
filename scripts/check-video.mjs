// Demo videosunun süresini ffprobe ile ölçer; 40–90 sn aralığındaysa docs/demo/ altına kopyalar.
// (ffprobe-static yerine sistem ffprobe'u kullanılır; bkz. docs/DECISIONS.md)
//   node scripts/check-video.mjs                         # Playwright: tests/e2e/videos/demo.mp4 → docs/demo/demo.mp4
//   node scripts/check-video.mjs --src cypress/videos/demo.cy.ts.mp4 --dst docs/demo/demo-cypress.mp4
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const src = path.resolve(args.src ?? "tests/e2e/videos/demo.mp4");
const dst = path.resolve(args.dst ?? "docs/demo/demo.mp4");
const MIN = Number(args.min ?? 40);
const MAX = Number(args.max ?? 90);

if (!fs.existsSync(src)) {
  console.error(`✗ Video yok: ${path.relative(process.cwd(), src)} — önce E2E testini çalıştırın`);
  process.exit(1);
}
const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", src]).toString().trim();
const dur = Number(out);
if (!Number.isFinite(dur)) {
  console.error("✗ Süre okunamadı:", out);
  process.exit(1);
}
console.log(`Demo videosu süresi: ${dur.toFixed(1)} sn (izin verilen aralık ${MIN}–${MAX} sn)`);
if (dur > MAX) {
  console.error(`✗ Video ${MAX} saniyeden uzun`);
  process.exit(1);
}
if (dur < MIN) {
  console.error(`✗ Video ${MIN} saniyeden kısa — izleyici takip edemez; senaryo beklemelerini artırın`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(`✓ ${path.relative(process.cwd(), dst)} kopyalandı (${(fs.statSync(dst).size / 1024).toFixed(0)} KB)`);
