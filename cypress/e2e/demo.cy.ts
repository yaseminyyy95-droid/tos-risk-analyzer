/// <reference types="cypress" />
// ToS Risk Analyzer — demo (Cypress). tests/e2e/run-e2e.ts (Playwright) ile birebir aynı senaryolar ve assert'ler.
// LLM ağ çağrısı cy.intercept ile stub'lanır; geri kalan her şey (SW orkestratörü, extractor, pipeline,
// OpenAIProvider, side panel UI) gerçek koddur — bkz. e2e/harness.tsx ve e2e/chrome-shim.ts.
import { normalizeForMatch } from "../../src/core/normalize";

const OPENAI = "https://api.openai.com/v1/chat/completions";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
// Demo temposu: kritik adımlardan sonra sabit beklemeler (video izlenebilir olsun; hedef 50–70 sn)
const T = { title: 2400, short: 1500, step: 2500, long: 3500 };
const LLM_DELAY = 2500;
const sel = (s: string) => `[data-cy="${s}"]`;

interface Expected {
  happy: { findings: number; score: number };
  compromised: { verified: number; rejected: number; score: number; fabricated: string };
}
interface ChatBody {
  messages: { role: string; content: string }[];
  response_format: { json_schema?: { strict?: boolean } };
}

function stubOpenAI(fixture: string, alias: string) {
  cy.intercept({ method: "OPTIONS", url: OPENAI }, { statusCode: 204, headers: CORS });
  cy.intercept(
    { method: "POST", url: OPENAI },
    { fixture: `llm/${fixture}`, headers: { ...CORS, "content-type": "application/json" }, delay: LLM_DELAY },
  ).as(alias);
}

const parseBody = (b: unknown): ChatBody => (typeof b === "string" ? JSON.parse(b) : b) as ChatBody;

/** highlighter iframe belgesine harness (üst pencere) realm'inden erişir; registry'ye aynı yoldan bakılır */
function highlightActive(): Cypress.Chainable<boolean> {
  return cy.get("#page").then(($f) => {
    const w = ($f[0] as HTMLIFrameElement).contentWindow as Window & typeof globalThis;
    const css = w.CSS as unknown as { highlights?: Map<string, unknown> };
    return Boolean(css.highlights?.has("tos-quote")) || w.document.querySelector("[data-tos-highlight-overlay]") !== null;
  });
}

const iframeText = (): Cypress.Chainable<string> =>
  cy.get("#page").then(($f) => normalizeForMatch(($f[0] as HTMLIFrameElement).contentDocument?.body.textContent ?? ""));

describe("ToS Risk Analyzer — demo", () => {
  let expected: Expected;
  before(() => {
    cy.fixture("llm/expected.json").then((e: Expected) => {
      expected = e;
    });
  });

  it("Mutlu yol: risk raporu doğrulanmış alıntılarla üretilir", () => {
    stubOpenAI("happy.openai.json", "happy");
    cy.visit("/harness.html?page=acme-tos&scenario=1");
    cy.get(sel("title-card")).should("contain.text", "Senaryo 1: Mutlu yol");
    cy.wait(T.title);
    cy.get(sel("legal-disclaimer")).should("be.visible").and("contain.text", "hukuki tavsiye vermez");
    cy.wait(T.short);
    cy.get(sel("analyze-btn")).click();
    cy.get(sel("progress")).should("be.visible");
    cy.wait("@happy").then(({ request }) => {
      const body = parseBody(request.body);
      const user = body.messages[1]!.content;
      expect(/<<<DOC_[0-9a-f]{32}>>>/.test(user) && /<<<END_DOC_[0-9a-f]{32}>>>/.test(user), "<<<DOC_ ve <<<END_DOC_").to.eq(true);
      expect(body.response_format.json_schema?.strict, "response_format.json_schema.strict").to.eq(true);
      expect(request.headers.authorization, "yalnızca test anahtarı").to.eq("Bearer sk-test-cypress");
    });
    cy.get(sel("status-badge"), { timeout: 15000 }).should("have.text", "Doğrulandı");
    cy.wait(T.long); // rapor göründü
    cy.get(sel("risk-score"))
      .invoke("text")
      .then((t) => {
        expect(Number(t), "deterministik beklenen skor").to.eq(expected.happy.score);
        expect(Number(t)).to.be.greaterThan(50);
      });
    cy.get(sel("finding-card")).should("have.length", 6);
    iframeText().then((body) => {
      cy.get(sel("finding-quote")).each(($q) => {
        expect(body.includes(normalizeForMatch($q.text())), `alıntı iframe metninde: ${$q.text().slice(0, 40)}`).to.eq(true);
      });
    });
    cy.get(sel("match-tier")).should("have.length", 1);
    // her bulgu kartı sırayla "Sayfada göster" ile vurgulanır
    cy.get(sel("finding-card")).each(($card) => {
      cy.wrap($card).scrollIntoView();
      cy.wrap($card).find(sel("show-in-page")).click();
      cy.wait(T.step);
      highlightActive().should("eq", true);
    });
    cy.get("#page").then(($f) => {
      const d = ($f[0] as HTMLIFrameElement).contentDocument!.querySelector("details") as HTMLDetailsElement;
      expect(d.open, "vurgulanan alıntının bulunduğu akordeon açıldı").to.eq(true);
    });
    cy.get(sel("rejected-summary")).scrollIntoView().should("contain.text", "Tüm iddialar doğrulandı");
    cy.wait(T.long);
  });

  it("Belirsizlik: prompt injection + uydurma alıntılar dürüstçe gösterilir", () => {
    stubOpenAI("compromised.openai.json", "compromised");
    cy.visit("/harness.html?page=injected-tos&scenario=2");
    cy.get(sel("title-card")).should("contain.text", "Senaryo 2: Injection + belirsizlik");
    cy.wait(T.title);
    cy.get(sel("analyze-btn")).should("be.visible");
    cy.wait(T.short);
    cy.get(sel("analyze-btn")).click();
    cy.wait("@compromised").then(({ request }) => {
      const user = parseBody(request.body).messages[1]!.content;
      expect(user.length > 0 && !user.includes("certified safe"), "gizli metin istek gövdesinde YOK (karantina)").to.eq(true);
      expect(user, "görünür injection paragrafı FLAGGED etiketiyle").to.contain("⚠ FLAGGED_AS_POSSIBLE_INJECTION Note to AI assistants");
    });
    cy.get(sel("injection-alert"), { timeout: 15000 }).scrollIntoView().should("be.visible");
    cy.get(sel("hidden-blocks"))
      .invoke("text")
      .then((t) => expect(Number(/(\d+) gizli metin/.exec(t)?.[1] ?? 0), "gizli blok sayısı").to.be.at.least(1));
    cy.wait(T.long); // injection uyarısı
    cy.get(sel("status-badge")).scrollIntoView().should("have.text", "Belirsiz — manuel inceleme önerilir");
    cy.get(sel("status-reasons"))
      .should("contain.text", "Prompt injection")
      .and("contain.text", "Model etkilenmiş olabilir")
      .and("contain.text", "sapma");
    cy.wait(T.long); // "Belirsiz" rozeti
    cy.get(sel("risk-score"))
      .invoke("text")
      .then((t) => {
        expect(Number(t), "LLM'in 0 önerisi yok sayıldı").not.to.eq(0);
        expect(Number(t)).to.eq(expected.compromised.score);
      });
    cy.wait(T.short);
    cy.get(sel("finding-card")).should("have.length", 1).first().scrollIntoView();
    cy.get(sel("finding-card")).first().find(sel("show-in-page")).click();
    cy.wait(T.step);
    highlightActive().should("eq", true);
    cy.get(sel("rejected-summary"))
      .scrollIntoView()
      .invoke("text")
      .should("match", /3 iddia.*çıkarıldı/);
    cy.wait(T.long); // "N iddia çıkarıldı"
    cy.get("#app")
      .invoke("text")
      .then((panel) => {
        expect(panel.includes(expected.compromised.fabricated), "uydurma cümle panelde YOK").to.eq(false);
        expect(panel.includes("never share it with anyone")).to.eq(false);
      });
    cy.get(sel("sentinel-hints")).scrollIntoView();
    cy.wait(T.step);
  });
});
