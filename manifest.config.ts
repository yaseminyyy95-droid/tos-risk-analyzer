import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ToS Risk Analyzer",
  description:
    "Kullanım koşulları ve gizlilik politikalarındaki riskli maddeleri doğrulanmış alıntılarla raporlar. Hukuki tavsiye vermez.",
  version: "0.1.0",
  permissions: ["activeTab", "scripting", "storage", "sidePanel", "contextMenus"],
  host_permissions: [
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://api.groq.com/*",
  ],
  optional_host_permissions: ["<all_urls>"],
  background: { service_worker: "src/background/service-worker.ts", type: "module" },
  action: { default_popup: "src/ui/popup/index.html", default_title: "ToS Risk Analyzer" },
  side_panel: { default_path: "src/ui/sidepanel/index.html" },
  options_page: "src/ui/options/index.html",
});
