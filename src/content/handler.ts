import { extractDocument, documentFromSelection } from "./extractor";
import { highlightQuote } from "./highlighter";
import type { ContentRequest, ContentResponse } from "../shared/messages";

/** Content script mesaj işleyicisi — belge parametre olarak alınır (E2E harness iframe belgesiyle çağırır). */
export function handleContentRequest(msg: ContentRequest, doc: Document): ContentResponse {
  try {
    const win = doc.defaultView;
    const url = win?.location.href ?? doc.URL;
    switch (msg.type) {
      case "CONTENT_EXTRACT":
        return { type: "EXTRACT_RESULT", doc: extractDocument(doc, { url }) };
      case "CONTENT_EXTRACT_SELECTION": {
        const sel = win?.getSelection()?.toString() ?? "";
        if (!sel.trim()) return { type: "ERROR", code: "EMPTY_SELECTION", message_tr: "Seçili metin bulunamadı." };
        return { type: "EXTRACT_RESULT", doc: documentFromSelection(sel, doc, url) };
      }
      case "HIGHLIGHT_QUOTE": {
        const r = highlightQuote(doc, String(msg.quote).slice(0, 600), msg.lang ?? null);
        return { type: "HIGHLIGHT_RESULT", found: r.found, method: r.method };
      }
      default:
        return { type: "ERROR", code: "UNKNOWN", message_tr: "Bilinmeyen istek." };
    }
  } catch {
    return { type: "ERROR", code: "CONTENT_FAILURE", message_tr: "Sayfa metni okunamadı." };
  }
}
