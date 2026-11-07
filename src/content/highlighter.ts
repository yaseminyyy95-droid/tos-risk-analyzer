import { normalizeWithMap, normalizeForMatch, caseFold } from "../core/normalize";

export const HIGHLIGHT_NAME = "tos-quote";
const OVERLAY_ATTR = "data-tos-highlight-overlay";
const BLOCKY = /^(p|li|h[1-6]|td|th|dd|dt|blockquote|pre|div|section|article|main|summary|details|ul|ol|table|tr|body)$/i;

interface TextPiece {
  node: Text;
  start: number; // concat içindeki başlangıç
}

function blockAncestor(n: Node): Node | null {
  let cur: Node | null = n.parentNode;
  while (cur && cur.nodeType === 1 && !BLOCKY.test((cur as Element).tagName)) cur = cur.parentNode;
  return cur;
}

function collectTextNodes(root: Node, out: Text[]) {
  for (const c of Array.from(root.childNodes)) {
    if (c.nodeType === 3) out.push(c as Text);
    else if (c.nodeType === 1) {
      const tag = (c as Element).tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") continue;
      if ((c as Element).hasAttribute(OVERLAY_ATTR)) continue;
      const sr = (c as HTMLElement).shadowRoot;
      collectTextNodes(sr ?? c, out);
    }
  }
}

/** Alıntıyı DOM'daki metin düğümlerinde (normalize edilmiş eşleşmeyle) bulur ve Range döndürür. */
export function findQuoteRange(doc: Document, quote: string, lang: string | null = null): Range | null {
  const nodes: Text[] = [];
  collectTextNodes(doc.body, nodes);
  let concat = "";
  const pieces: TextPiece[] = [];
  let prevBlock: Node | null = null;
  for (const n of nodes) {
    const b = blockAncestor(n);
    if (concat && b !== prevBlock) concat += " ";
    prevBlock = b;
    pieces.push({ node: n, start: concat.length });
    concat += n.data;
  }
  const nm = normalizeWithMap(concat);
  const q = normalizeForMatch(quote);
  if (!q) return null;
  let idx = nm.text.indexOf(q);
  if (idx < 0) {
    // case-insensitive: uzunluk değişmeyen katlama varsa
    const hay = caseFold(nm.text, lang);
    const needle = caseFold(q, lang);
    if (hay.length === nm.text.length) idx = hay.indexOf(needle);
  }
  if (idx < 0) return null;
  const startOrig = nm.map[idx]!;
  const endOrig = nm.mapEnd[idx + q.length - 1]!;
  const locate = (pos: number, isEnd: boolean): { node: Text; offset: number } | null => {
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]!;
      if (pos >= p.start || i === 0) {
        const off = Math.min(Math.max(pos - p.start, 0), p.node.data.length);
        if (isEnd && off === 0 && i > 0) {
          const prev = pieces[i - 1]!;
          return { node: prev.node, offset: prev.node.data.length };
        }
        return { node: p.node, offset: off };
      }
    }
    return null;
  };
  const s = locate(startOrig, false);
  const e = locate(endOrig, true);
  if (!s || !e) return null;
  const range = doc.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

export function clearHighlights(doc: Document) {
  const w = doc.defaultView as (Window & typeof globalThis) | null;
  const css = w?.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined;
  css?.highlights?.delete(HIGHLIGHT_NAME);
  doc.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach((n) => n.remove());
}

let styleInstalled = new WeakSet<Document>();

function installHighlightStyle(doc: Document) {
  if (styleInstalled.has(doc)) return;
  const w = doc.defaultView as (Window & typeof globalThis) | null;
  try {
    const sheet = new (w ?? window).CSSStyleSheet();
    sheet.replaceSync(`::highlight(${HIGHLIGHT_NAME}) { background-color: #ffd54a; color: #111; }`);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } catch {
    /* constructable stylesheet yoksa vurgulama yine de çalışır (stilsiz) */
  }
  styleInstalled.add(doc);
}

export function resetHighlighterForTests() {
  styleInstalled = new WeakSet<Document>();
}

/**
 * Alıntıyı vurgular: CSS Custom Highlight API (DOM metnine dokunmaz). API yoksa
 * Range.getBoundingClientRect ile mutlak konumlu bir overlay çizilir.
 */
export function highlightQuote(doc: Document, quote: string, lang: string | null = null): { found: boolean; method: "css-highlight" | "overlay" | null } {
  clearHighlights(doc);
  const range = findQuoteRange(doc, quote, lang);
  if (!range) return { found: false, method: null };
  const w = doc.defaultView as (Window & typeof globalThis & { Highlight?: new (...r: Range[]) => unknown }) | null;
  const css = w?.CSS as (typeof CSS & { highlights?: Map<string, unknown> }) | undefined;
  const target = range.startContainer.parentElement;
  target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  if (css?.highlights && w?.Highlight) {
    installHighlightStyle(doc);
    css.highlights.set(HIGHLIGHT_NAME, new w.Highlight(range));
    return { found: true, method: "css-highlight" };
  }
  const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  if (!rects.length && typeof range.getBoundingClientRect === "function") rects.push(range.getBoundingClientRect());
  if (!rects.length && target) rects.push(target.getBoundingClientRect());
  const sx = w?.scrollX ?? 0;
  const sy = w?.scrollY ?? 0;
  for (const r of rects) {
    const div = doc.createElement("div");
    div.setAttribute(OVERLAY_ATTR, "");
    Object.assign(div.style, {
      position: "absolute",
      left: `${r.left + sx}px`,
      top: `${r.top + sy}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      background: "rgba(255, 213, 74, 0.45)",
      pointerEvents: "none",
      zIndex: "2147483647",
    });
    doc.body.appendChild(div);
  }
  return { found: true, method: "overlay" };
}
