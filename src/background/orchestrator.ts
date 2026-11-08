// Service worker orkestratörü. chrome API'si parametre olarak alınır: gerçek uzantıda `chrome`,
// E2E harness'ında süreç içi shim. Bu dosya tek ayrıcalıklı bileşendir: API anahtarını yalnızca burası okur.
import { analyzeDocument, canonicalTextOf, failedReport, isAbortError } from "../core/pipeline";
import { createProvider, PROVIDER_LABEL, ProviderError } from "../core/providers";
import type { HttpOptions } from "../core/providers/http";
import {
  ContentResponseSchema,
  ExtPageToSwSchema,
  LegalDetectedSchema,
  PanelToSwSchema,
  PORT_NAME,
  type ContentRequest,
  type ErrorCode,
  type ExtractedDocument,
  type PanelToSw,
  type SwToPanel,
} from "../shared/messages";
import type { ProviderId } from "../shared/types";
import { loadSettings, saveSettings } from "./settings";
import { deleteKey, getKey, hardenStorage, keyStatuses, setKey } from "./keystore";
import { cacheClear, cacheGet, cacheKey, cachePut } from "./cache";

export const CONTENT_SCRIPT_FILE = "content.js";
export const CONTEXT_MENU_ID = "tos-analyze-selection";
export const AUTO_SCRIPT_ID = "tos-auto-detect";
const JOBS_KEY = "jobs";
const PENDING_KEY = "pendingActions";

export interface OrchestratorOptions {
  /** Test/harness: sağlayıcı HTTP seçenekleri (ör. fetch implementasyonu) */
  http?: HttpOptions;
}

type JobState = { state: "running" | "done" | "error"; startedAt: number; reportId?: string };
type PendingAction = "analyze" | "analyze_selection";

export function initBackground(api: typeof chrome, opts: OrchestratorOptions = {}) {
  const activeJobs = new Map<number, AbortController>();

  // Not: options_page bir sekmede açılır, bu yüzden sender.tab dolu olabilir. Belirleyici olan
  // gönderen belgenin URL'sinin uzantının kendi kökeninde (chrome-extension://<id>/) olmasıdır;
  // content script mesajlarında sender.url web sayfasının adresidir ve reddedilir.
  const isExtensionPage = (sender: chrome.runtime.MessageSender) =>
    sender.id === api.runtime.id && (sender.url ?? "").startsWith(api.runtime.getURL(""));

  async function setJob(tabId: number, job: JobState | null) {
    const r = await api.storage.session.get(JOBS_KEY);
    const jobs = (r[JOBS_KEY] ?? {}) as Record<string, JobState>;
    if (job) jobs[String(tabId)] = job;
    else delete jobs[String(tabId)];
    await api.storage.session.set({ [JOBS_KEY]: jobs });
  }
  async function getJob(tabId: number): Promise<JobState | null> {
    const r = await api.storage.session.get(JOBS_KEY);
    return ((r[JOBS_KEY] ?? {}) as Record<string, JobState>)[String(tabId)] ?? null;
  }
  async function setPending(tabId: number, action: PendingAction | null) {
    const r = await api.storage.session.get(PENDING_KEY);
    const p = (r[PENDING_KEY] ?? {}) as Record<string, PendingAction>;
    if (action) p[String(tabId)] = action;
    else delete p[String(tabId)];
    await api.storage.session.set({ [PENDING_KEY]: p });
  }
  async function takePending(tabId: number): Promise<PendingAction | null> {
    const r = await api.storage.session.get(PENDING_KEY);
    const p = (r[PENDING_KEY] ?? {}) as Record<string, PendingAction>;
    const a = p[String(tabId)] ?? null;
    if (a) await setPending(tabId, null);
    return a;
  }

  async function sendToContent(tabId: number, msg: ContentRequest) {
    await api.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    const raw = await api.tabs.sendMessage(tabId, msg);
    const parsed = ContentResponseSchema.safeParse(raw); // content script'ten gelen veri güvenilmez
    if (!parsed.success) throw Object.assign(new Error("invalid content response"), { code: "EXTRACTION_INVALID" as ErrorCode });
    return parsed.data;
  }

  async function runAnalysis(port: chrome.runtime.Port, tabId: number, mode: "tab" | "selection", bypassCache: boolean) {
    const post = (m: SwToPanel) => {
      try {
        port.postMessage(m);
      } catch {
        /* panel kapandı */
      }
    };
    const fail = (code: ErrorCode, message_tr: string) => post({ type: "ERROR", code, message_tr });

    const settings = await loadSettings(api);
    const provider = settings.provider;
    const model = settings.models[provider];
    const key = await getKey(api, provider);
    if (!key) return fail("NO_API_KEY", "API anahtarı tanımlı değil. Ayarlar sayfasından bir sağlayıcı anahtarı ekleyin.");
    if (!settings.consent[provider]) {
      post({ type: "NEEDS_CONSENT", provider, providerLabel: PROVIDER_LABEL[provider] });
      return;
    }

    activeJobs.get(tabId)?.abort();
    const ac = new AbortController();
    activeJobs.set(tabId, ac);
    await setJob(tabId, { state: "running", startedAt: Date.now() });
    try {
      post({ type: "PROGRESS", event: { stage: "extracting" } });
      let doc: ExtractedDocument;
      try {
        const res = await sendToContent(tabId, { type: mode === "tab" ? "CONTENT_EXTRACT" : "CONTENT_EXTRACT_SELECTION" });
        if (res.type === "ERROR") return fail(res.code === "EMPTY_SELECTION" ? "EMPTY_DOCUMENT" : "INTERNAL", res.message_tr);
        if (res.type !== "EXTRACT_RESULT") return fail("EXTRACTION_INVALID", "Sayfadan beklenmeyen yanıt alındı.");
        doc = res.doc;
      } catch (e) {
        if ((e as { code?: string }).code === "EXTRACTION_INVALID") return fail("EXTRACTION_INVALID", "Sayfadan gelen veri doğrulanamadı.");
        return fail(
          "INJECTION_FAILED",
          "Bu sayfaya erişilemedi. Araç çubuğundaki uzantı simgesine tıklayarak analizi başlatın (veya bu sayfa türü desteklenmiyor: chrome://, Web Mağazası, PDF).",
        );
      }
      if (!doc.blocks.length) return fail("EMPTY_DOCUMENT", "Sayfada analiz edilecek metin bulunamadı.");

      const ck = await cacheKey(canonicalTextOf(doc), provider, model);
      if (!bypassCache) {
        const cached = await cacheGet(api.storage.local, ck);
        if (cached) {
          await setJob(tabId, { state: "done", startedAt: Date.now(), reportId: cached.reportId });
          await api.storage.session.set({ [`report:${tabId}`]: cached });
          post({ type: "REPORT", report: cached, fromCache: true });
          return;
        }
      }

      const llm = createProvider(provider, key, { ...(opts.http ?? {}), refusalFallback: settings.refusalFallback });
      let report;
      try {
        ({ report } = await analyzeDocument(doc, llm, { model, signal: ac.signal, onProgress: (event) => post({ type: "PROGRESS", event }) }));
      } catch (e) {
        if (isAbortError(e)) return fail("CANCELLED", "Analiz iptal edildi.");
        const msg = e instanceof ProviderError ? e.message_tr : "Beklenmeyen bir hata oluştu.";
        report = failedReport(doc, "provider_error", provider, model, msg);
      }
      if (report.status !== "FAILED") await cachePut(api.storage.local, ck, report);
      await api.storage.session.set({ [`report:${tabId}`]: report });
      await setJob(tabId, { state: "done", startedAt: Date.now(), reportId: report.reportId });
      post({ type: "REPORT", report, fromCache: false });
    } finally {
      if (activeJobs.get(tabId) === ac) activeJobs.delete(tabId);
      const j = await getJob(tabId);
      if (j?.state === "running") await setJob(tabId, { ...j, state: "error" });
    }
  }

  async function handlePanelMessage(port: chrome.runtime.Port, raw: unknown) {
    const parsed = PanelToSwSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg: PanelToSw = parsed.data;
    switch (msg.type) {
      case "ANALYZE_TAB":
        return runAnalysis(port, msg.tabId, "tab", msg.bypassCache === true);
      case "ANALYZE_SELECTION":
        return runAnalysis(port, msg.tabId, "selection", true);
      case "CANCEL":
        for (const ac of activeJobs.values()) ac.abort();
        return;
      case "GRANT_CONSENT": {
        const s = await loadSettings(api);
        await saveSettings(api, { consent: { ...s.consent, [msg.provider]: true } });
        return;
      }
      case "HIGHLIGHT_QUOTE": {
        try {
          const r = await sendToContent(msg.tabId, { type: "HIGHLIGHT_QUOTE", quote: msg.quote, lang: msg.lang });
          port.postMessage({ type: "HIGHLIGHT_RESULT", found: r.type === "HIGHLIGHT_RESULT" && r.found } satisfies SwToPanel);
        } catch {
          port.postMessage({ type: "HIGHLIGHT_RESULT", found: false } satisfies SwToPanel);
        }
        return;
      }
      case "GET_STATE": {
        const job = await getJob(msg.tabId);
        const rep = (await api.storage.session.get(`report:${msg.tabId}`))[`report:${msg.tabId}`] ?? null;
        let state: "idle" | "running" | "interrupted" = "idle";
        if (job?.state === "running") state = activeJobs.has(msg.tabId) ? "running" : "interrupted"; // SW yeniden başladıysa
        port.postMessage({ type: "STATE", state, report: rep } satisfies SwToPanel);
        const pending = await takePending(msg.tabId);
        if (pending === "analyze") return runAnalysis(port, msg.tabId, "tab", false);
        if (pending === "analyze_selection") return runAnalysis(port, msg.tabId, "selection", true);
        return;
      }
    }
  }

  // ---- side panel portu: port aktivitesi SW'yi uzun LLM çağrısı boyunca canlı tutar ----
  api.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    if (port.sender && !isExtensionPage(port.sender)) {
      port.disconnect();
      return;
    }
    port.onMessage.addListener((m) => void handlePanelMessage(port, m));
    port.onDisconnect.addListener(() => {
      /* panel kapanınca devam eden işler iptal edilir */
      for (const ac of activeJobs.values()) ac.abort();
    });
  });

  // ---- options / popup ve content script mesajları ----
  api.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const detected = LegalDetectedSchema.safeParse(raw);
    if (detected.success) {
      if (sender.tab?.id !== undefined && sender.id === api.runtime.id)
        void api.action.setBadgeText({ tabId: sender.tab.id, text: detected.data.confidence >= 0.6 ? "§" : "" }).catch(() => {});
      return false;
    }
    if (!isExtensionPage(sender)) return false; // anahtar işlemleri yalnızca uzantı sayfalarından
    const parsed = ExtPageToSwSchema.safeParse(raw);
    if (!parsed.success) return false;
    const m = parsed.data;
    void (async () => {
      switch (m.type) {
        case "SET_KEY":
          await setKey(api, m.provider, m.key, m.sessionOnly);
          return sendResponse({ ok: true });
        case "DELETE_KEY":
          await deleteKey(api, m.provider);
          return sendResponse({ ok: true });
        case "KEY_STATUS":
          return sendResponse({ ok: true, statuses: await keyStatuses(api) });
        case "TEST_KEY": {
          const key = await getKey(api, m.provider);
          if (!key) return sendResponse({ ok: false, message_tr: "Kayıtlı anahtar yok." });
          const r = await createProvider(m.provider as ProviderId, key, opts.http ?? {}).testKey();
          return sendResponse(r);
        }
        case "CLEAR_CACHE":
          await cacheClear(api.storage.local);
          return sendResponse({ ok: true });
        case "OPEN_PANEL_AND_ANALYZE":
          await setPending(m.tabId, "analyze");
          return sendResponse({ ok: true });
      }
    })().catch(() => sendResponse({ ok: false, message_tr: "İşlem başarısız." }));
    return true;
  });

  // ---- bağlam menüsü: seçili metni analiz et ----
  api.runtime.onInstalled?.addListener(() => {
    api.contextMenus?.create({ id: CONTEXT_MENU_ID, title: "Seçili metni risk analizinden geçir", contexts: ["selection"] }, () => void api.runtime.lastError);
  });
  api.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined) return;
    // sidePanel.open kullanıcı jestinde senkron çağrılmalı
    void api.sidePanel.open({ tabId: tab.id }).catch(() => {});
    void setPending(tab.id, "analyze_selection");
  });

  // ---- otomatik algılama (opsiyonel <all_urls> izni) ----
  async function syncAutoDetect() {
    const s = await loadSettings(api);
    const has = await api.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
    const existing = await api.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] }).catch(() => []);
    if (s.autoDetect && has && existing.length === 0) {
      await api.scripting
        .registerContentScripts([{ id: AUTO_SCRIPT_ID, matches: ["<all_urls>"], js: [CONTENT_SCRIPT_FILE], runAt: "document_idle", persistAcrossSessions: true }])
        .catch(() => {});
    } else if ((!s.autoDetect || !has) && existing.length > 0) {
      await api.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] }).catch(() => {});
    }
  }
  api.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes.settings) void syncAutoDetect();
  });
  api.permissions?.onRemoved?.addListener(() => void syncAutoDetect());

  void hardenStorage(api);
  void syncAutoDetect().catch(() => {});
  return { activeJobs, runAnalysis };
}
