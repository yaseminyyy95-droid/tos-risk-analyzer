// E2E harness: soldaki iframe'de fixture ToS sayfası, sağda gerçek side panel uygulaması.
// chrome.* API'leri süreç içi shim ile sağlanır; gerçek orkestratör, extractor, pipeline ve
// OpenAIProvider çalışır. Yalnızca api.openai.com ağ çağrısı test aracı tarafından stub'lanır.
import { render } from "preact";
import "../src/ui/styles.css";
import { createChromeShim } from "./chrome-shim";
import { initBackground } from "../src/background/orchestrator";
import { SidePanelApp } from "../src/ui/sidepanel/App";

const TEST_KEY = "sk-test-cypress";
const params = new URLSearchParams(location.search);
const page = (params.get("page") ?? "acme-tos").replace(/[^a-z0-9-]/gi, "");
const iframe = document.getElementById("page") as HTMLIFrameElement;

iframe.addEventListener(
  "load",
  async () => {
    const shim = createChromeShim({ getDocument: () => iframe.contentDocument!, tabUrl: () => iframe.contentWindow!.location.href });
    await shim.api.storage.local.set({
      settings: { provider: "openai", models: { openai: "gpt-4.1" }, consent: { openai: true }, developerMode: false },
      "apiKey:openai": TEST_KEY,
    });
    initBackground(shim.api);
    (window as unknown as { __harness: unknown }).__harness = shim;
    render(<SidePanelApp api={shim.api} />, document.getElementById("app")!);
  },
  { once: true },
);
iframe.src = `/pages/${page}.html`;
