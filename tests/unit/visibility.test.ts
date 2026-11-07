// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseColor, contrastRatio, classifyElement, isLegitCollapsible, defaultStyleGetter } from "../../src/content/visibility";

function el(html: string): Element {
  document.body.innerHTML = html; // eslint-disable-line no-restricted-syntax -- test fixture
  return document.querySelector("[data-t]")!;
}
const ctx = (textLength = 100, inCollapsed = false) => ({ inCollapsed, getStyle: defaultStyleGetter, textLength });

describe("visibility", () => {
  it("parseColor hex/rgb/rgba/named", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#00000080")![3]).toBeCloseTo(0.5, 1);
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30, 0.5]);
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5]);
    expect(parseColor("transparent")![3]).toBe(0);
    expect(parseColor("weird")).toBeNull();
  });
  it("contrastRatio siyah/beyaz = 21, aynı renk = 1", () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 0);
    expect(contrastRatio([200, 200, 200, 1], [200, 200, 200, 1])).toBe(1);
  });
  it("normal metin visible", () => {
    expect(classifyElement(el(`<p data-t>Hello world</p>`), ctx())).toEqual({ cls: "visible" });
  });
  it("collapsed bağlamda visible → collapsed_ui", () => {
    expect(classifyElement(el(`<p data-t>Hello</p>`), ctx(100, true))).toEqual({ cls: "collapsed_ui" });
  });
  it("hidden attribute + role=tabpanel meşru sayılır", () => {
    const e = el(`<div role="tabpanel" hidden data-t>Tab content</div>`);
    expect(isLegitCollapsible(e)).toBe(true);
    expect(classifyElement(e, ctx())?.cls).toBe("collapsed_ui");
  });
  it("aria-labelledby → aria-expanded tetikleyici meşru sayılır", () => {
    const e = el(`<button id="b1" aria-expanded="false">Q</button><div><div id="p1" aria-labelledby="b1" style="display:none" data-t>Answer text</div></div>`);
    expect(classifyElement(e, ctx())?.cls).toBe("collapsed_ui");
  });
  it("collapse içinde bile 1px yazı adversarial", () => {
    expect(classifyElement(el(`<p data-t style="font-size:1px">x</p>`), ctx(100, true))).toEqual({ cls: "adversarial_hidden", reason: "tiny_font" });
  });
  it("yarı saydam renk (alpha<0.05) transparent", () => {
    expect(classifyElement(el(`<p data-t style="color:rgba(0,0,0,0.01)">x</p>`), ctx())?.reason).toBe("transparent");
  });
  it("koyu zemin üzerinde koyu yazı low_contrast", () => {
    expect(classifyElement(el(`<div style="background:#111"><p data-t style="color:#121212">x</p></div>`), ctx())?.reason).toBe("low_contrast");
  });
  it("text-indent ile ekran dışı", () => {
    expect(classifyElement(el(`<p data-t style="text-indent:-9999px">x</p>`), ctx())?.reason).toBe("offscreen");
  });
});
