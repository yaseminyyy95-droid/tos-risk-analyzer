import type { VerifiedReport } from "../core/schema";
import { sha256Hex } from "../core/hash";
import { PROMPT_VERSION } from "../core/prompt";

export const CACHE_KEY = "reportCache";
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAX = 30;

interface Entry {
  report: VerifiedReport;
  createdAt: number;
  lastUsed: number;
}
type CacheData = Record<string, Entry>;

export async function cacheKey(canonicalText: string, provider: string, model: string): Promise<string> {
  return sha256Hex(`${canonicalText}\u0000${provider}\u0000${model}\u0000${PROMPT_VERSION}`);
}

async function load(storage: chrome.storage.StorageArea): Promise<CacheData> {
  const r = await storage.get(CACHE_KEY);
  const d = r[CACHE_KEY];
  return d && typeof d === "object" ? (d as CacheData) : {};
}

export async function cacheGet(storage: chrome.storage.StorageArea, key: string, now = Date.now()): Promise<VerifiedReport | null> {
  const data = await load(storage);
  const e = data[key];
  if (!e) return null;
  if (now - e.createdAt > CACHE_TTL_MS) {
    delete data[key];
    await storage.set({ [CACHE_KEY]: data });
    return null;
  }
  e.lastUsed = now;
  await storage.set({ [CACHE_KEY]: data });
  return e.report;
}

export async function cachePut(storage: chrome.storage.StorageArea, key: string, report: VerifiedReport, now = Date.now()): Promise<void> {
  const data = await load(storage);
  for (const [k, e] of Object.entries(data)) if (now - e.createdAt > CACHE_TTL_MS) delete data[k];
  data[key] = { report, createdAt: now, lastUsed: now };
  const keys = Object.keys(data);
  if (keys.length > CACHE_MAX) {
    keys
      .sort((a, b) => data[a]!.lastUsed - data[b]!.lastUsed)
      .slice(0, keys.length - CACHE_MAX)
      .forEach((k) => delete data[k]);
  }
  await storage.set({ [CACHE_KEY]: data });
}

export async function cacheClear(storage: chrome.storage.StorageArea): Promise<void> {
  await storage.remove(CACHE_KEY);
}
