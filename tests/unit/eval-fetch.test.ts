import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkRawDir } from "../../eval/scripts/fetch";
import type { Manifest } from "../../eval/scripts/lib";

const manifest: Manifest = {
  notice: "",
  synthetic: [],
  documents: [
    { id: "zoom-tos", company: "Zoom", docType: "terms_of_service", url: "https://example.test/zoom", retrievedAt: null, sha256: null, extractor: null },
    { id: "reddit-ua", company: "Reddit", docType: "terms_of_service", url: "https://example.test/reddit", retrievedAt: null, sha256: null, extractor: null },
  ],
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "raw-"));

describe("eval:fetch --from-raw ön kontrolü", () => {
  it("eval/raw boşken anlaşılır Türkçe hata ve beklenen dosya adları", () => {
    const r = checkRawDir(manifest, null, tmp());
    expect(r.ok).toBe(false);
    expect(r.message).toContain("klasöründe işlenecek HTML dosyası yok");
    expect(r.message).toContain("zoom-tos.html");
    expect(r.message).toContain("reddit-ua.html");
    expect(r.message).toContain("REAL_CORPUS_STEPS.md");
  });
  it("klasör hiç yoksa da aynı hata", () => {
    expect(checkRawDir(manifest, null, path.join(tmp(), "yok")).ok).toBe(false);
  });
  it("bazı dosyalar varsa devam eder ve eksikleri listeler", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "zoom-tos.html"), "<html></html>");
    expect(checkRawDir(manifest, null, d)).toEqual({ ok: true, message: "", missing: ["reddit-ua"] });
  });
  it("--only bilinmeyen kimlik → hata", () => {
    expect(checkRawDir(manifest, "netflix", tmp()).message).toContain("manifest'te yok");
  });
});
