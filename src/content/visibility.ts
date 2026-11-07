import type { HiddenReason, VisibilityClass } from "../core/types";

export type StyleGetter = (el: Element) => CSSStyleDeclaration;

export interface Classification {
  cls: VisibilityClass;
  reason?: HiddenReason;
}

export const SR_ONLY_MAX_CHARS = 40;
export const ARIA_HIDDEN_MAX_CHARS = 40;
export const CONTRAST_MIN = 1.15;

export function defaultStyleGetter(el: Element): CSSStyleDeclaration {
  const win = el.ownerDocument.defaultView ?? window;
  return win.getComputedStyle(el);
}

// ---------- renk ----------
export type RGBA = [number, number, number, number];

const NAMED: Record<string, RGBA> = {
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
  transparent: [0, 0, 0, 0],
  red: [255, 0, 0, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
};

export function parseColor(input: string | null | undefined): RGBA | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s]!;
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  return null;
}

function luminance([r, g, b]: RGBA): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function blend(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

/** En yakın opak atanın arka plan rengi (yoksa beyaz kanvas). */
export function effectiveBackground(el: Element, gs: StyleGetter): RGBA {
  let cur: Element | null = el;
  while (cur) {
    const c = parseColor(gs(cur).backgroundColor);
    if (c && c[3] >= 0.95) return c;
    cur = parentElementAcrossShadow(cur);
  }
  return [255, 255, 255, 1];
}

/** Etkin yazı rengi (jsdom kalıtımı uygulamadığı için atalara bakılır). */
export function effectiveColor(el: Element, gs: StyleGetter): RGBA | null {
  let cur: Element | null = el;
  while (cur) {
    const c = parseColor(gs(cur).color);
    if (c) return c;
    cur = parentElementAcrossShadow(cur);
  }
  return null;
}

export function parentElementAcrossShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root && (root as ShadowRoot).host ? (root as ShadowRoot).host : null;
}

function directText(el: Element): string {
  let t = "";
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? "";
  return t.trim();
}

function px(v: string | null | undefined): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : NaN;
}

/** display:none / hidden olan bir elemanın meşru açılır-kapanır UI parçası olup olmadığı. */
export function isLegitCollapsible(el: Element): boolean {
  const doc = el.ownerDocument;
  if (el.closest("details")) return true;
  const id = el.id;
  if (id) {
    const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, "\\$&");
    if (doc.querySelector(`[aria-controls~="${esc}"], [data-bs-target="#${esc}"], [data-target="#${esc}"], a[href="#${esc}"][aria-expanded]`))
      return true;
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const lid of labelledBy.split(/\s+/)) {
        const lab = doc.getElementById(lid);
        if (lab && lab.hasAttribute("aria-expanded")) return true;
      }
    }
  }
  if (el.closest('[role="tabpanel"], [role="region"]')) return true;
  const prev = el.previousElementSibling;
  if (prev && (prev.hasAttribute("aria-expanded") || prev.querySelector("[aria-expanded]"))) return true;
  return false;
}

export interface ClassifyContext {
  /** bir üst eleman collapsed_ui ise true (ör. kapalı <details> içi) */
  inCollapsed: boolean;
  getStyle: StyleGetter;
  /** elemanın toplam metin uzunluğu (sr-only / aria-hidden eşiği için) */
  textLength: number;
}

/**
 * Bir elemanı tek başına sınıflandırır. Atadan miras alınan durum çağıranın sorumluluğundadır.
 * Dönüş: visible | collapsed_ui | adversarial_hidden (+ sebep) | null (= sessizce atla, ör. kısa aria-hidden ikon)
 */
export function classifyElement(el: Element, ctx: ClassifyContext): Classification | null {
  const st = ctx.getStyle(el);
  const textLen = ctx.textLength;

  // aria-hidden
  if (el.getAttribute("aria-hidden") === "true") {
    if (textLen > ARIA_HIDDEN_MAX_CHARS) return { cls: "adversarial_hidden", reason: "aria_hidden" };
    return null;
  }

  // görüntülenmeyen elemanlar
  const notDisplayed = st.display === "none" || st.visibility === "hidden" || st.visibility === "collapse" || el.hasAttribute("hidden");
  if (notDisplayed) {
    if (ctx.inCollapsed || isLegitCollapsible(el)) return { cls: "collapsed_ui" };
    return { cls: "adversarial_hidden", reason: "display_none" };
  }

  // yalnızca px (tarayıcıda computed değer hep px'tir; jsdom "1.5em" gibi ham değer verebilir)
  const fontSize = /px$/.test(st.fontSize ?? "") ? px(st.fontSize) : NaN;
  if (!Number.isNaN(fontSize) && fontSize < 2) return { cls: "adversarial_hidden", reason: "tiny_font" };

  const opacity = parseFloat(st.opacity);
  if (Number.isFinite(opacity) && opacity < 0.05) return { cls: "adversarial_hidden", reason: "transparent" };

  // ekran dışı (stil tabanlı + layout varsa rect tabanlı)
  if (st.position === "absolute" || st.position === "fixed") {
    const left = px(st.left);
    const top = px(st.top);
    if ((!Number.isNaN(left) && left < -1000) || (!Number.isNaN(top) && top < -1000))
      return { cls: "adversarial_hidden", reason: "offscreen" };
  }
  const indent = px(st.textIndent);
  if (!Number.isNaN(indent) && indent < -1000) return { cls: "adversarial_hidden", reason: "offscreen" };
  if (!ctx.inCollapsed && typeof el.getBoundingClientRect === "function") {
    const r = el.getBoundingClientRect();
    const win = el.ownerDocument.defaultView;
    const sx = win?.scrollX ?? 0;
    const sy = win?.scrollY ?? 0;
    if ((r.width > 0 || r.height > 0) && (r.right + sx < -500 || r.bottom + sy < -500))
      return { cls: "adversarial_hidden", reason: "offscreen" };
  }

  // clip / sr-only
  const clip = (st.clip ?? "").replace(/\s+/g, "");
  const clipPath = (st.clipPath ?? "").replace(/\s+/g, "");
  const clipped = /^rect\(0(px)?,0(px)?,0(px)?,0(px)?\)$/.test(clip) || /^rect\(0(px)?0(px)?0(px)?0(px)?\)$/.test(clip) || clipPath === "inset(100%)" || clipPath === "inset(50%)";
  const w = px(st.width);
  const h = px(st.height);
  const tiny = (!Number.isNaN(w) && w <= 1) || (!Number.isNaN(h) && h <= 1);
  if (clipped || (tiny && st.overflow === "hidden" && (st.position === "absolute" || st.position === "fixed"))) {
    if (textLen <= SR_ONLY_MAX_CHARS) return { cls: "visible" };
    return { cls: "adversarial_hidden", reason: "clipped" };
  }

  // renk / arka plan kontrastı — yalnızca doğrudan metni olan elemanlarda
  if (directText(el)) {
    const fg = effectiveColor(el, ctx.getStyle);
    if (fg) {
      if (fg[3] < 0.05) return { cls: "adversarial_hidden", reason: "transparent" };
      const bg = effectiveBackground(el, ctx.getStyle);
      if (contrastRatio(blend(fg, bg), bg) < CONTRAST_MIN) return { cls: "adversarial_hidden", reason: "low_contrast" };
    }
  }

  return { cls: ctx.inCollapsed ? "collapsed_ui" : "visible" };
}
