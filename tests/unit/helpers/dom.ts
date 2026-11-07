/** Test fixture HTML'ini DOMParser ile ayrıştırıp body'ye taşır (HTML dizgesi doğrudan DOM'a atanmaz). */
export function setBodyHtml(html: string, doc: Document = document): void {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  doc.body.replaceChildren(...Array.from(parsed.body.childNodes).map((n) => doc.importNode(n, true)));
}
