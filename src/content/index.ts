// Content script: chrome.scripting.executeScript ile (kullanıcı aksiyonunda) veya
// otomatik algılama açıksa registerContentScripts ile enjekte edilir. API anahtarına erişimi YOKTUR.
import { extractDocument, documentFromSelection } from "./extractor";
import { highlightQuote } from "./highlighter";
import { legalPageConfidence } from "./detector";
import type { ContentRequest, ContentResponse } from "../shared/messages";

declare global {
  interface Window {
    __tosRiskAnalyzerLoaded?: boolean;
  }
}

function handle(msg: ContentRequest): ContentResponse {
  try {
    switch (msg.type) {
      case "CONTENT_EXTRACT":
        return { type: "EXTRACT_RESULT", doc: extractDocument(document, { url: location.href }) };
      case "CONTENT_EXTRACT_SELECTION": {
        const sel = window.getSelection()?.toString() ?? "";
        if (!sel.trim()) return { type: "ERROR", code: "EMPTY_SELECTION", message_tr: "Seçili metin bulunamadı." };
        return { type: "EXTRACT_RESULT", doc: documentFromSelection(sel, document, location.href) };
      }
      case "HIGHLIGHT_QUOTE": {
        const r = highlightQuote(document, String(msg.quote).slice(0, 600), msg.lang ?? null);
        return { type: "HIGHLIGHT_RESULT", found: r.found, method: r.method };
      }
      default:
        return { type: "ERROR", code: "UNKNOWN", message_tr: "Bilinmeyen istek." };
    }
  } catch {
    return { type: "ERROR", code: "CONTENT_FAILURE", message_tr: "Sayfa metni okunamadı." };
  }
}

if (!window.__tosRiskAnalyzerLoaded) {
  window.__tosRiskAnalyzerLoaded = true;
  chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
    // Yalnızca kendi uzantımızdan gelen mesajlar (sayfa bu kanala yazamaz)
    if (sender.id !== chrome.runtime.id) return false;
    sendResponse(handle(msg));
    return false;
  });
  // Otomatik algılama: hafif güven skoru gönder (SW rozet gösterir)
  try {
    const conf = legalPageConfidence({
      url: location.href,
      title: document.title,
      h1: document.querySelector("h1")?.textContent ?? "",
      text: (document.body?.textContent ?? "").slice(0, 60_000),
    });
    chrome.runtime.sendMessage({ type: "LEGAL_PAGE_DETECTED", confidence: conf }).catch(() => {});
  } catch {
    /* yok say */
  }
}
