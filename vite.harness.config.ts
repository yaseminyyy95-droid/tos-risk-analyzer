import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

// E2E harness: e2e/harness.html + fixtures/ (public) → dist-harness/
export default defineConfig({
  root: resolve(__dirname, "e2e"),
  publicDir: resolve(__dirname, "fixtures"),
  plugins: [preact()],
  build: {
    outDir: resolve(__dirname, "dist-harness"),
    emptyOutDir: true,
    rollupOptions: { input: { harness: resolve(__dirname, "e2e/harness.html") } },
  },
  preview: { port: 4173, strictPort: true },
});
