// Content script: chrome.scripting.executeScript ile (kullanıcı aksiyonunda) veya otomatik algılama
// açıksa registerContentScripts ile enjekte edilir. API anahtarına ve chrome.storage'a erişmez.
import { handleContentRequest } from "./handler";
import { legalPageConfidence } from "./detector";
import type { ContentRequest } from "../shared/messages";

declare global {
  interface Window {
    __tosRiskAnalyzerLoaded?: boolean;
  }
}

if (!window.__tosRiskAnalyzerLoaded) {
  window.__tosRiskAnalyzerLoaded = true;
  chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
    // Yalnızca kendi uzantımızın service worker'ından gelen istekler
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    sendResponse(handleContentRequest(msg, document));
    return false;
  });
  // Otomatik algılama: hafif güven skoru (SW yalnızca rozet gösterir)
  try {
    const confidence = legalPageConfidence({
      url: location.href,
      title: document.title,
      h1: document.querySelector("h1")?.textContent ?? "",
      text: (document.body?.textContent ?? "").slice(0, 60_000),
    });
    void chrome.runtime.sendMessage({ type: "LEGAL_PAGE_DETECTED", confidence }).catch(() => {});
  } catch {
    /* yok say */
  }
}
