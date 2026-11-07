import type { ExtractedBlock, ExtractedDocument, HiddenReason, QuarantinedBlock, VisibilityClass } from "../core/types";
import { isLikelyInjection } from "../core/injection";
import { classifyElement, defaultStyleGetter, type StyleGetter } from "./visibility";
import { legalPageConfidence } from "./detector";

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "nav", "form", "button",
  "input", "select", "textarea", "option", "img", "video", "audio", "object", "embed", "link", "meta", "head",
]);
const BLOCK_TAGS = new Set([
  "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dd", "dt", "blockquote", "pre",
  "figcaption", "caption", "summary", "div", "section", "article", "main", "aside", "ul", "ol",
  "dl", "table", "tr", "tbody", "thead", "details", "header", "footer", "address", "body", "br", "hr",
]);
const ROOT_SELECTORS = ["main", "article", "[role=main]", "#content", ".legal", ".terms", ".privacy"];
const MIN_ROOT_CHARS = 500;

export interface ExtractOptions {
  getStyle?: StyleGetter;
  url?: string;
  now?: () => Date;
}

function cleanText(s: string): string {
  return s.replace(/[\s\u00A0]+/g, " ").trim();
}

function selectorHint(el: Element): string {
  let s = el.tagName.toLowerCase();
  if (el.id) s += "#" + el.id;
  const cls = el.getAttribute("class")?.trim().split(/\s+/)[0];
  if (cls) s += "." + cls;
  return s.slice(0, 80);
}

/** Atlanacak etiketleri hariç tutarak (shadow DOM dahil) ham metin toplar. */
export function rawText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1 && node.nodeType !== 11) return "";
  const el = node as Element;
  if (node.nodeType === 1 && SKIP_TAGS.has(el.tagName.toLowerCase()) && el.tagName.toLowerCase() !== "nav") return "";
  let t = "";
  const sr = node.nodeType === 1 ? (el as HTMLElement).shadowRoot : null;
  for (const c of Array.from((sr ?? node).childNodes)) t += rawText(c) + (c.nodeType === 1 && BLOCK_TAGS.has((c as Element).tagName.toLowerCase()) ? " " : "");
  return t;
}

/** Kök seçimi: bilinen seçiciler → yoksa paragraf yoğunluğu skoru (Readability benzeri). */
export function selectRoot(doc: Document): Element {
  for (const sel of ROOT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && cleanText(rawText(el)).length >= MIN_ROOT_CHARS) return el;
  }
  const scores = new Map<Element, number>();
  for (const p of Array.from(doc.querySelectorAll("p, li"))) {
    const len = cleanText(p.textContent ?? "").length;
    if (len < 25) continue;
    const parent = p.parentElement;
    const gp = parent?.parentElement;
    if (parent) scores.set(parent, (scores.get(parent) ?? 0) + len);
    if (gp) scores.set(gp, (scores.get(gp) ?? 0) + len / 2);
  }
  let best: Element | null = null;
  let bestScore = 0;
  for (const [el, sc] of scores) {
    const text = cleanText(el.textContent ?? "");
    const linkText = Array.from(el.querySelectorAll("a")).reduce((a, x) => a + cleanText(x.textContent ?? "").length, 0);
    const linkDensity = text.length ? linkText / text.length : 1;
    const s = sc * (1 - linkDensity);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return best ?? doc.body;
}

interface WalkState {
  blocks: ExtractedBlock[];
  quarantined: QuarantinedBlock[];
  headingStack: { level: number; text: string }[];
  buffer: string;
  bufferTag: string;
  bufferVis: VisibilityClass;
  getStyle: StyleGetter;
  rootIsBody: boolean;
}

function flush(st: WalkState) {
  const text = cleanText(st.buffer);
  st.buffer = "";
  if (!text) return;
  st.blocks.push({
    text,
    headingPath: st.headingStack.map((h) => h.text),
    tag: st.bufferTag,
    visibility: st.bufferVis,
  });
}

function appendText(st: WalkState, text: string, tag: string, vis: VisibilityClass) {
  if (st.buffer && (st.bufferVis !== vis || st.bufferTag !== tag)) flush(st);
  st.bufferTag = tag;
  st.bufferVis = vis;
  st.buffer += text;
}

function quarantine(st: WalkState, el: Element, reason: HiddenReason) {
  const text = cleanText(rawText(el));
  if (text) st.quarantined.push({ text, reason, selectorHint: selectorHint(el) });
}

function walk(node: Node, st: WalkState, blockTag: string, inCollapsed: boolean) {
  // HTML yorumu: hiç alınmaz; injection kalıbı içeriyorsa karantinaya kaydedilir
  if (node.nodeType === 8) {
    const t = cleanText(node.textContent ?? "");
    if (t && isLikelyInjection(t)) st.quarantined.push({ text: t, reason: "html_comment", selectorHint: "<!-- -->" });
    return;
  }
  if (node.nodeType === 3) {
    const t = node.textContent ?? "";
    if (t) appendText(st, t, blockTag, inCollapsed ? "collapsed_ui" : "visible");
    return;
  }
  if (node.nodeType !== 1) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  if ((tag === "header" || tag === "footer") && st.rootIsBody) return;
  if (tag === "br") {
    appendText(st, " ", blockTag, inCollapsed ? "collapsed_ui" : "visible");
    return;
  }

  const textLength = cleanText(rawText(el)).length;
  if (textLength === 0 && tag !== "iframe" && !(el as HTMLElement).shadowRoot) return;
  const cls = classifyElement(el, { inCollapsed, getStyle: st.getStyle, textLength });
  if (cls === null) return; // kısa aria-hidden (ikon vb.)
  if (cls.cls === "adversarial_hidden") {
    quarantine(st, el, cls.reason ?? "display_none");
    return;
  }
  const collapsed = inCollapsed || cls.cls === "collapsed_ui";

  // same-origin iframe
  if (tag === "iframe") {
    let body: HTMLElement | null = null;
    try {
      body = (el as HTMLIFrameElement).contentDocument?.body ?? null;
    } catch {
      body = null; // cross-origin
    }
    if (body) {
      flush(st);
      for (const c of Array.from(body.childNodes)) walk(c, st, "div", collapsed);
      flush(st);
    }
    return;
  }

  const isBlock = BLOCK_TAGS.has(tag);
  const myTag = isBlock ? tag : blockTag;
  if (isBlock) flush(st);

  const headingMatch = /^h([1-6])$/.exec(tag);
  if (headingMatch) {
    const level = Number(headingMatch[1]);
    const text = cleanText(rawText(el));
    while (st.headingStack.length && st.headingStack[st.headingStack.length - 1]!.level >= level) st.headingStack.pop();
    if (text) st.headingStack.push({ level, text });
  }

  // <details>: summary görünür, içerik collapsed_ui
  const childCollapsed = collapsed || (tag === "details" && !(el as HTMLDetailsElement).open);

  const shadow = (el as HTMLElement).shadowRoot;
  const children = shadow ? Array.from(shadow.childNodes) : Array.from(el.childNodes);
  for (const c of children) {
    if (c.nodeType === 1 && (c as Element).tagName.toLowerCase() === "slot") {
      const slot = c as HTMLSlotElement;
      let assigned: Node[] = [];
      try {
        assigned = slot.assignedNodes({ flatten: true });
      } catch {
        assigned = [];
      }
      const nodes = assigned.length ? assigned : Array.from(slot.childNodes);
      for (const n of nodes) walk(n, st, myTag, childCollapsed);
      continue;
    }
    const isSummary = c.nodeType === 1 && (c as Element).tagName.toLowerCase() === "summary";
    walk(c, st, myTag, isSummary ? collapsed : childCollapsed);
  }
  if (isBlock) flush(st);
}

export function extractDocument(doc: Document, opts: ExtractOptions = {}): ExtractedDocument {
  const getStyle = opts.getStyle ?? defaultStyleGetter;
  const root = selectRoot(doc);
  const st: WalkState = {
    blocks: [],
    quarantined: [],
    headingStack: [],
    buffer: "",
    bufferTag: "div",
    bufferVis: "visible",
    getStyle,
    rootIsBody: root === doc.body,
  };
  // kökün atalarındaki başlıkları bağlam olarak al (ör. main dışında kalan h1)
  const h1 = doc.querySelector("h1");
  if (h1 && !root.contains(h1)) st.headingStack.push({ level: 1, text: cleanText(h1.textContent ?? "") });

  // kök dışındaki HTML yorumlarını da tara
  const tw = doc.createTreeWalker(doc.documentElement, 128 /* NodeFilter.SHOW_COMMENT */);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!root.contains(n)) walk(n, st, "div", false);
  }

  const rootCls = root === doc.body ? null : classifyElement(root, { inCollapsed: false, getStyle, textLength: 1000 });
  if (rootCls && rootCls.cls === "adversarial_hidden") {
    quarantine(st, root, rootCls.reason ?? "display_none");
  } else {
    walk(root, st, "div", false);
  }
  flush(st);

  // aynı metnin ardışık tekrarlarını temizle
  const blocks = st.blocks.filter((b, i, arr) => i === 0 || b.text !== arr[i - 1]!.text);
  const visibleChars = blocks.reduce((a, b) => a + b.text.length, 0);
  const quarantinedChars = st.quarantined.reduce((a, b) => a + b.text.length, 0);
  const url = opts.url ?? doc.location?.href ?? "";
  const title = cleanText(doc.title || h1?.textContent || "");
  return {
    url,
    title,
    lang: doc.documentElement.getAttribute("lang") || null,
    extractedAt: (opts.now?.() ?? new Date()).toISOString(),
    blocks,
    quarantined: st.quarantined,
    stats: { totalChars: visibleChars + quarantinedChars, visibleChars, quarantinedChars },
    legalPageConfidence: legalPageConfidence({
      url,
      title,
      h1: cleanText(h1?.textContent ?? ""),
      text: blocks.map((b) => b.text).join("\n"),
    }),
  };
}

/** Kullanıcı seçimi → ExtractedDocument (bağlam menüsü). */
export function documentFromSelection(selectionText: string, doc: Document, url: string): ExtractedDocument {
  const parts = selectionText.split(/\n\s*\n|\r\n\s*\r\n/).map(cleanText).filter(Boolean);
  const blocks: ExtractedBlock[] = parts.map((text) => ({ text, headingPath: [], tag: "p", visibility: "visible" }));
  const chars = blocks.reduce((a, b) => a + b.text.length, 0);
  return {
    url,
    title: cleanText(doc.title) + " (seçim)",
    lang: doc.documentElement.getAttribute("lang") || null,
    extractedAt: new Date().toISOString(),
    blocks,
    quarantined: [],
    stats: { totalChars: chars, visibleChars: chars, quarantinedChars: 0 },
    legalPageConfidence: legalPageConfidence({ url, title: doc.title, h1: "", text: blocks.map((b) => b.text).join("\n") }),
  };
}
