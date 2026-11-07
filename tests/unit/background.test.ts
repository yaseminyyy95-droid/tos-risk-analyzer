// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { setBodyHtml } from "./helpers/dom";
import { createChromeShim, type ChromeShim } from "../../e2e/chrome-shim";
import { initBackground } from "../../src/background/orchestrator";
import { getKey, setKey, deleteKey, keyStatuses } from "../../src/background/keystore";
import { cacheGet, cachePut, cacheKey, CACHE_MAX, CACHE_TTL_MS } from "../../src/background/cache";
import { loadSettings, saveSettings, normalizeSettings } from "../../src/background/settings";
import { PORT_NAME, type SwToPanel } from "../../src/shared/messages";
import type { VerifiedReport } from "../../src/core/schema";
import { ARB, RENEW, NEUTRAL } from "./helpers/factory";

const KEY = "sk-test-unit-abcdefgh1234";

function setPage() {
  document.title = "Acme Terms of Service";
  setBodyHtml(`<main><h1>Terms</h1>${[ARB, RENEW, NEUTRAL, NEUTRAL, NEUTRAL, ARB.replace("Acme", "Acme Cloud")]
    .map((t) => `<p>${t} ${NEUTRAL}</p>`)
    .join("")}</main>`);
}

function fakeFetch(content: () => string) {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify({ choices: [{ message: { content: content(), refusal: null } }] }), { status: 200 });
  };
  return { fetchImpl, calls };
}

const emptyReport = () =>
  JSON.stringify({
    schema_version: "1.0", document_type: "terms_of_service", document_language: "en", llm_suggested_score: 0,
    summary_tr: "Bu belgede önemli bir risk bulunamadı.", findings: [], injection_suspected: false, injection_segment_ids: [], uncertainty_notes_tr: null,
  });

function collect(shim: ChromeShim) {
  const port = shim.api.runtime.connect({ name: PORT_NAME });
  const msgs: SwToPanel[] = [];
  port.onMessage.addListener((m: SwToPanel) => void msgs.push(m));
  const waitFor = async (pred: (m: SwToPanel) => boolean, ms = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = msgs.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("timeout; got " + JSON.stringify(msgs.map((m) => m.type)));
  };
  return { port, msgs, waitFor };
}

describe("keystore", () => {
  let shim: ChromeShim;
  beforeEach(() => (shim = createChromeShim({ getDocument: () => document })));
  it("local'e yazar, sessionOnly ise session'a yazar ve local'den siler", async () => {
    await setKey(shim.api, "openai", KEY, false);
    expect(shim.local.data.get("apiKey:openai")).toBe(KEY);
    await setKey(shim.api, "openai", KEY, true);
    expect(shim.local.data.has("apiKey:openai")).toBe(false);
    expect(shim.session.data.get("apiKey:openai")).toBe(KEY);
    expect(await getKey(shim.api, "openai")).toBe(KEY);
  });
  it("durum yalnızca maske döndürür; silme her iki alanı temizler", async () => {
    await setKey(shim.api, "anthropic", "sk-ant-api03-zzzzzzzzzz9876", false);
    const st = await keyStatuses(shim.api);
    expect(JSON.stringify(st)).not.toContain("zzzzzzzzzz");
    expect(st.find((s) => s.provider === "anthropic")!.masked).toBe("sk-ant-…9876");
    await deleteKey(shim.api, "anthropic");
    expect(await getKey(shim.api, "anthropic")).toBeNull();
  });
});

describe("cache", () => {
  const rep = (id: string) => ({ reportId: id }) as VerifiedReport;
  let shim: ChromeShim;
  beforeEach(() => (shim = createChromeShim({ getDocument: () => document })));
  it("anahtar metin+sağlayıcı+model+prompt versiyonuna bağlıdır", async () => {
    expect(await cacheKey("t", "openai", "a")).not.toBe(await cacheKey("t", "openai", "b"));
    expect(await cacheKey("t", "openai", "a")).toBe(await cacheKey("t", "openai", "a"));
  });
  it("TTL dolunca kayıt düşer", async () => {
    await cachePut(shim.api.storage.local, "k", rep("1"), 0);
    expect(await cacheGet(shim.api.storage.local, "k", 1000)).toEqual(rep("1"));
    expect(await cacheGet(shim.api.storage.local, "k", CACHE_TTL_MS + 1)).toBeNull();
  });
  it("en fazla 30 kayıt; LRU en eskisini atar", async () => {
    for (let i = 0; i <= CACHE_MAX; i++) await cachePut(shim.api.storage.local, `k${i}`, rep(String(i)), 1000 + i);
    expect(await cacheGet(shim.api.storage.local, "k0", 5000)).toBeNull();
    expect(await cacheGet(shim.api.storage.local, `k${CACHE_MAX}`, 5000)).not.toBeNull();
  });
});

describe("settings", () => {
  it("geçersiz değerleri varsayılana normalize eder", () => {
    const s = normalizeSettings({ provider: "evil", models: { openai: "" }, consent: { openai: "yes" } });
    expect(s.provider).toBe("openai");
    expect(s.models.openai).toBe("gpt-4.1");
    expect(s.consent).toEqual({});
  });
  it("kaydet / yükle", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    await saveSettings(shim.api, { provider: "anthropic", consent: { anthropic: true } });
    expect((await loadSettings(shim.api)).provider).toBe("anthropic");
    expect(shim.local.data.get("settings")).not.toHaveProperty("apiKey");
  });
});

describe("orchestrator (SW)", () => {
  beforeEach(setPage);

  it("anahtar yoksa NO_API_KEY", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    initBackground(shim.api);
    const c = collect(shim);
    c.port.postMessage({ type: "ANALYZE_TAB", tabId: 1 });
    expect(await c.waitFor((m) => m.type === "ERROR")).toMatchObject({ code: "NO_API_KEY" });
  });

  it("ilk kullanımda onay ister; onaydan sonra analiz eder, ilerleme ve rapor gönderir; ikinci istek önbellekten", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    await setKey(shim.api, "openai", KEY, false);
    const ff = fakeFetch(emptyReport);
    initBackground(shim.api, { http: { fetchImpl: ff.fetchImpl } });
    const c = collect(shim);
    c.port.postMessage({ type: "ANALYZE_TAB", tabId: 1 });
    expect(await c.waitFor((m) => m.type === "NEEDS_CONSENT")).toMatchObject({ providerLabel: "OpenAI" });
    expect(ff.calls).toHaveLength(0);
    c.port.postMessage({ type: "GRANT_CONSENT", provider: "openai" });
    await new Promise((r) => setTimeout(r, 20));
    c.port.postMessage({ type: "ANALYZE_TAB", tabId: 1 });
    const rep = await c.waitFor((m) => m.type === "REPORT");
    expect(rep).toMatchObject({ fromCache: false });
    expect(c.msgs.some((m) => m.type === "PROGRESS" && m.event.stage === "analyzing")).toBe(true);
    expect(shim.injectedTabs.has(1)).toBe(true);
    expect(ff.calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    // rapor ve ilerleme mesajları anahtarı içermez
    expect(JSON.stringify(c.msgs)).not.toContain(KEY);
    c.msgs.length = 0;
    c.port.postMessage({ type: "ANALYZE_TAB", tabId: 1 });
    expect(await c.waitFor((m) => m.type === "REPORT")).toMatchObject({ fromCache: true });
    expect(ff.calls).toHaveLength(1);
    c.msgs.length = 0;
    c.port.postMessage({ type: "ANALYZE_TAB", tabId: 1, bypassCache: true });
    expect(await c.waitFor((m) => m.type === "REPORT")).toMatchObject({ fromCache: false });
    expect(ff.calls).toHaveLength(2);
  });

  it("content script'ten gelen geçersiz veri reddedilir", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    await setKey(shim.api, "openai", KEY, false);
    await saveSettings(shim.api, { consent: { openai: true } });
    (shim.api.tabs as unknown as { sendMessage: unknown }).sendMessage = async () => ({ type: "EXTRACT_RESULT", doc: { evil: true } });
    initBackground(shim.api);
    const c = collect(shim);
    c.port.postMessage({ type: "ANALYZE_TAB", tabId: 1 });
    expect(await c.waitFor((m) => m.type === "ERROR")).toMatchObject({ code: "EXTRACTION_INVALID" });
  });

  it("GET_STATE: kayıtta running ama aktif iş yoksa interrupted (SW yeniden başladı)", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    await shim.api.storage.session.set({ jobs: { "1": { state: "running", startedAt: 1 } } });
    initBackground(shim.api);
    const c = collect(shim);
    c.port.postMessage({ type: "GET_STATE", tabId: 1 });
    expect(await c.waitFor((m) => m.type === "STATE")).toMatchObject({ state: "interrupted" });
  });

  it("uzantı sayfası olmayan göndericiden anahtar işlemi kabul edilmez; uzantı sayfasından edilir", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    initBackground(shim.api);
    const listeners = [...(shim.api.runtime.onMessage as unknown as { listeners: Set<(...a: unknown[]) => unknown> }).listeners];
    const fromContent = listeners[0]!({ type: "SET_KEY", provider: "openai", key: KEY, sessionOnly: false }, { id: shim.api.runtime.id, tab: { id: 1 }, url: "https://evil.example" }, () => {});
    expect(fromContent).toBe(false);
    expect(await getKey(shim.api, "openai")).toBeNull();
    const res = await shim.api.runtime.sendMessage({ type: "SET_KEY", provider: "openai", key: KEY, sessionOnly: false });
    expect(res).toEqual({ ok: true });
    const st = (await shim.api.runtime.sendMessage({ type: "KEY_STATUS" })) as { statuses: { masked: string }[] };
    expect(JSON.stringify(st)).not.toContain(KEY);
  });

  it("HIGHLIGHT_QUOTE content script'e iletilir", async () => {
    const shim = createChromeShim({ getDocument: () => document });
    initBackground(shim.api);
    const c = collect(shim);
    c.port.postMessage({ type: "HIGHLIGHT_QUOTE", tabId: 1, quote: "binding individual arbitration, and you waive", lang: "en" });
    expect(await c.waitFor((m) => m.type === "HIGHLIGHT_RESULT")).toMatchObject({ found: true });
  });
});
