// Sistemde önceden kurulu (global) Playwright'ın E2E/smoke betiklerinde kullanılan alt kümesi.
// Paket projeye bağımlılık olarak eklenmez (bkz. docs/DECISIONS.md); çalışma zamanında createRequire ile yüklenir.
declare module "playwright" {
  export interface Request {
    method(): string;
    postData(): string | null;
    headers(): Record<string, string>;
  }
  export interface Route {
    request(): Request;
    fulfill(o: { status?: number; headers?: Record<string, string>; body?: string }): Promise<void>;
  }
  export interface Locator {
    waitFor(o?: { timeout?: number }): Promise<void>;
    textContent(): Promise<string | null>;
    allTextContents(): Promise<string[]>;
    isVisible(): Promise<boolean>;
    count(): Promise<number>;
    click(): Promise<void>;
    first(): Locator;
    nth(i: number): Locator;
    filter(o: { hasText: string }): Locator;
    locator(sel: string): Locator;
    scrollIntoViewIfNeeded(): Promise<void>;
  }
  export interface Frame {
    evaluate<R>(fn: () => R): Promise<R>;
  }
  export interface Video {
    path(): Promise<string>;
  }
  export interface Page {
    goto(url: string): Promise<unknown>;
    locator(sel: string): Locator;
    frameLocator(sel: string): { locator(sel: string): Locator };
    frame(o: { url: RegExp }): Frame | null;
    evaluate<R>(fn: () => R): Promise<R>;
    route(url: string, h: (r: Route) => Promise<void>): Promise<void>;
    unroute(url: string): Promise<void>;
    on(ev: "pageerror", h: (e: Error) => void): void;
    screenshot(o: { path: string }): Promise<unknown>;
    video(): Video | null;
  }
  export interface BrowserContext {
    newPage(): Promise<Page>;
    setDefaultTimeout(ms: number): void;
    close(): Promise<void>;
  }
  export interface Browser {
    newContext(o?: { viewport?: { width: number; height: number }; recordVideo?: { dir: string; size?: { width: number; height: number } } }): Promise<BrowserContext>;
    close(): Promise<void>;
  }
  export const chromium: { launch(o?: object): Promise<Browser> };
}
