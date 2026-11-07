import { defineConfig } from "vite";

// Content script, chrome.scripting.executeScript({ files: ["content.js"] }) ile enjekte edilir.
// executeScript ile verilen dosyalar klasik script olarak çalışır; bu yüzden tek dosyalık IIFE üretiyoruz.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: "src/content/index.ts",
      formats: ["iife"],
      name: "TosRiskContent",
      fileName: () => "content.js",
    },
  },
});
