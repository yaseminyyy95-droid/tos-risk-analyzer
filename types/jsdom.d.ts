// Projede kullanılan jsdom API'sinin minimal tip bildirimi (@types/jsdom eklemeden).
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; contentType?: string });
    readonly window: Window & typeof globalThis;
  }
}
