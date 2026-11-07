// Demo videosunun süresini ffprobe ile ölçer; ≤ 90 sn ise docs/demo/demo.mp4 olarak kopyalar.
// (ffprobe-static yerine sistem ffprobe'u kullanılır — yeni bağımlılık yok; bkz. docs/DECISIONS.md)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const src = path.resolve("tests/e2e/videos/demo.mp4");
const dst = path.resolve("docs/demo/demo.mp4");
const LIMIT = 90;
if (!fs.existsSync(src)) {
  console.error(`Video yok: ${src} — önce npm run e2e`);
  process.exit(1);
}
const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", src]).toString().trim();
const dur = Number(out);
if (!Number.isFinite(dur)) {
  console.error("Süre okunamadı:", out);
  process.exit(1);
}
console.log(`Demo videosu süresi: ${dur.toFixed(1)} sn (sınır ${LIMIT} sn)`);
if (dur > LIMIT) {
  console.error("✗ Video 90 saniyeden uzun");
  process.exit(1);
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(`✓ ${path.relative(process.cwd(), dst)} kopyalandı (${(fs.statSync(dst).size / 1024).toFixed(0)} KB)`);
