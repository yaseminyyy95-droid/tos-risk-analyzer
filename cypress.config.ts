import { defineConfig } from "cypress";

// Cypress E2E (ödev şartı). Playwright E2E (tests/e2e/run-e2e.ts) ile aynı iki senaryo ve aynı assert'ler.
// Harness: npm run harness:build → vite preview :4173 (bkz. README "Cypress'i kendi makinende çalıştırma").
export default defineConfig({
  video: true,
  videoCompression: 32,
  viewportWidth: 1440,
  viewportHeight: 900,
  defaultCommandTimeout: 8000,
  screenshotOnRunFailure: true,
  trashAssetsBeforeRuns: true,
  fixturesFolder: "fixtures", // Playwright ile ortak fixture'lar (fixtures/llm, fixtures/pages)
  e2e: {
    baseUrl: "http://localhost:4173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
  },
});
