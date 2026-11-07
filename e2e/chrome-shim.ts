// E2E harness + unit testler için süreç içi chrome.* taklidi.
// Gerçek orkestratör (SW), gerçek content handler (iframe belgesi üzerinde) ve gerçek UI bu shim üzerinden konuşur.
import { handleContentRequest } from "../src/content/handler";
import type { ContentRequest } from "../src/shared/messages";

type Listener<A extends unknown[]> = (...args: A) => unknown;

function event<A extends unknown[]>() {
  const ls = new Set<Listener<A>>();
  return {
    addListener: (l: Listener<A>) => void ls.add(l),
    removeListener: (l: Listener<A>) => void ls.delete(l),
    hasListener: (l: Listener<A>) => ls.has(l),
    emit: (...a: A) => [...ls].map((l) => l(...a)),
    listeners: ls,
  };
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function storageArea(name: string, onChanged: ReturnType<typeof event<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>>) {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys?: string | string[] | null) {
      const ks = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of ks) if (data.has(k)) out[k] = clone(data.get(k));
      return out;
    },
    async set(items: Record<string, unknown>) {
      const ch: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        ch[k] = { oldValue: data.get(k), newValue: clone(v) };
        data.set(k, clone(v));
      }
      onChanged.emit(ch, name);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    async clear() {
      data.clear();
    },
    async setAccessLevel() {},
  };
}

export interface ShimOptions {
  /** content script'in çalışacağı belge (iframe.contentDocument) */
  getDocument: () => Document;
  tabUrl?: () => string;
  extensionId?: string;
  pagePath?: string;
}

export interface ChromeShim {
  api: typeof chrome;
  injectedTabs: Set<number>;
  sentToContent: ContentRequest[];
  local: ReturnType<typeof storageArea>;
  session: ReturnType<typeof storageArea>;
}

export function createChromeShim(opts: ShimOptions): ChromeShim {
  const id = opts.extensionId ?? "harnessextensionid";
  const base = `chrome-extension://${id}/`;
  const pageUrl = base + (opts.pagePath ?? "src/ui/sidepanel/index.html");
  const storageChanged = event<[Record<string, { oldValue?: unknown; newValue?: unknown }>, string]>();
  const local = storageArea("local", storageChanged);
  const session = storageArea("session", storageChanged);
  const onConnect = event<[chrome.runtime.Port]>();
  const onMessage = event<[unknown, chrome.runtime.MessageSender, (r: unknown) => void]>();
  const injectedTabs = new Set<number>();
  const sentToContent: ContentRequest[] = [];

  function makePortPair(name: string, sender: chrome.runtime.MessageSender) {
    const aMsg = event<[unknown, chrome.runtime.Port]>();
    const bMsg = event<[unknown, chrome.runtime.Port]>();
    const aDisc = event<[chrome.runtime.Port]>();
    const bDisc = event<[chrome.runtime.Port]>();
    let connected = true;
    const a = {
      name,
      sender: undefined,
      onMessage: aMsg,
      onDisconnect: aDisc,
      postMessage: (m: unknown) => {
        if (!connected) throw new Error("Port disconnected");
        const c = clone(m);
        setTimeout(() => bMsg.emit(c, b as unknown as chrome.runtime.Port), 0);
      },
      disconnect: () => {
        connected = false;
        bDisc.emit(b as unknown as chrome.runtime.Port);
      },
    };
    const b = {
      name,
      sender,
      onMessage: bMsg,
      onDisconnect: bDisc,
      postMessage: (m: unknown) => {
        if (!connected) throw new Error("Port disconnected");
        const c = clone(m);
        setTimeout(() => aMsg.emit(c, a as unknown as chrome.runtime.Port), 0);
      },
      disconnect: () => {
        connected = false;
        aDisc.emit(a as unknown as chrome.runtime.Port);
      },
    };
    return { client: a, server: b };
  }

  const api = {
    runtime: {
      id,
      lastError: undefined,
      getURL: (p: string) => base + p.replace(/^\//, ""),
      connect: ({ name }: { name: string }) => {
        const { client, server } = makePortPair(name, { id, url: pageUrl });
        setTimeout(() => onConnect.emit(server as unknown as chrome.runtime.Port), 0);
        return client;
      },
      onConnect,
      onMessage,
      onInstalled: event<[]>(),
      sendMessage: async (msg: unknown) => {
        await tick();
        return new Promise((resolve) => {
          let responded = false;
          const results = onMessage.emit(clone(msg), { id, url: pageUrl }, (r) => {
            responded = true;
            resolve(clone(r));
          });
          if (!responded && !results.some((x) => x === true)) resolve(undefined);
        });
      },
      openOptionsPage: async () => {},
    },
    storage: { local, session, onChanged: storageChanged },
    tabs: {
      query: async () => [{ id: 1, windowId: 1, url: opts.tabUrl?.() ?? "https://acme.example/terms", title: opts.getDocument().title, active: true }],
      sendMessage: async (tabId: number, msg: ContentRequest) => {
        await tick();
        if (!injectedTabs.has(tabId)) throw new Error("Could not establish connection. Receiving end does not exist.");
        sentToContent.push(clone(msg));
        return clone(handleContentRequest(msg, opts.getDocument()));
      },
      create: async () => ({}),
    },
    scripting: {
      executeScript: async ({ target }: { target: { tabId: number } }) => {
        await tick();
        injectedTabs.add(target.tabId);
        return [];
      },
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => {},
      unregisterContentScripts: async () => {},
    },
    sidePanel: { open: async () => {} },
    action: { setBadgeText: async () => {} },
    contextMenus: { create: () => {}, onClicked: event<[chrome.contextMenus.OnClickData, chrome.tabs.Tab | undefined]>() },
    permissions: { contains: async () => false, request: async () => false, onRemoved: event<[]>(), onAdded: event<[]>() },
  };
  return { api: api as unknown as typeof chrome, injectedTabs, sentToContent, local, session };
}
