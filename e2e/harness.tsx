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

// Demo videosu için 2 sn'lik başlık ekranı: ?scenario=1|2
const TITLES: Record<string, [string, string]> = {
  "1": ["Senaryo 1: Mutlu yol", "Risk raporu, orijinal metinde doğrulanmış alıntılarla üretilir"],
  "2": ["Senaryo 2: Injection + belirsizlik", "Gizli talimat, uydurma alıntılar ve ele geçirilmiş model"],
};
const scenario = params.get("scenario");
const titleCard = document.getElementById("title-card")!;
if (scenario && TITLES[scenario]) {
  const [h, sub] = TITLES[scenario]!;
  const strong = document.createElement("div");
  strong.textContent = h;
  const small = document.createElement("small");
  small.textContent = sub;
  titleCard.replaceChildren(strong, small);
  titleCard.classList.remove("hidden");
  titleCard.setAttribute("data-state", "visible");
  setTimeout(() => {
    titleCard.classList.add("hidden");
    titleCard.setAttribute("data-state", "hidden");
  }, Number(params.get("titleMs") ?? 2000));
}

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
