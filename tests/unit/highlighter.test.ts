// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { setBodyHtml } from "./helpers/dom";
import { findQuoteRange, highlightQuote, clearHighlights } from "../../src/content/highlighter";

function setBody(html: string) {
  setBodyHtml(html);
}

describe("highlighter", () => {
  it("inline elemanlara bölünmüş alıntıyı bulur", () => {
    setBody(`<p>You <b>waive</b> your right to a <i>jury trial</i> and class action.</p>`);
    const r = findQuoteRange(document, "You waive your right to a jury trial")!;
    expect(r.toString()).toBe("You waive your right to a jury trial");
  });
  it("tipografik tırnak ve NBSP farkını tolere eder", () => {
    setBody(`<p>We may use your content (“User Content”)\u00A0to train models.</p>`);
    const r = findQuoteRange(document, `use your content ("User Content") to train models`)!;
    expect(r).not.toBeNull();
    expect(r.toString()).toContain("User Content");
  });
  it("farklı bloklar arasında boşluk ekler", () => {
    setBody(`<p>First block ends here.</p><p>Second block starts.</p>`);
    expect(findQuoteRange(document, "ends here. Second block")).not.toBeNull();
  });
  it("bulunamayan alıntı null", () => {
    setBody(`<p>Nothing to see.</p>`);
    expect(findQuoteRange(document, "We fully protect your data")).toBeNull();
  });
  it("CSS Highlight API yoksa overlay fallback kullanır ve temizler", () => {
    setBody(`<p>Refunds are not available for partial months.</p>`);
    const res = highlightQuote(document, "Refunds are not available");
    expect(res).toEqual({ found: true, method: "overlay" });
    expect(document.querySelectorAll("[data-tos-highlight-overlay]").length).toBeGreaterThan(0);
    expect(document.body.querySelector("p")!.textContent).toBe("Refunds are not available for partial months.");
    clearHighlights(document);
    expect(document.querySelectorAll("[data-tos-highlight-overlay]").length).toBe(0);
  });
});
