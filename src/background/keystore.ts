// API anahtarı deposu — YALNIZCA service worker'da kullanılır.
// Anahtarlar chrome.storage.local'da (asla sync) veya "yalnızca bu oturum" seçiliyse chrome.storage.session'da tutulur.
// storage.session erişim seviyesi TRUSTED_CONTEXTS'tir: content script'ler okuyamaz.
import type { ProviderId } from "../shared/types";
import type { KeyStatus } from "../shared/messages";
import { maskKey } from "../core/providers/http";

const keyName = (p: ProviderId) => `apiKey:${p}`;
const PROVIDERS: ProviderId[] = ["openai", "anthropic", "groq"];

export async function hardenStorage(api: typeof chrome): Promise<void> {
  try {
    await api.storage.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch {
    /* eski sürümler: varsayılan zaten TRUSTED_CONTEXTS */
  }
}

export async function getKey(api: typeof chrome, p: ProviderId): Promise<string | null> {
  const s = await api.storage.session.get(keyName(p));
  const fromSession = s[keyName(p)];
  if (typeof fromSession === "string" && fromSession) return fromSession;
  const l = await api.storage.local.get(keyName(p));
  const fromLocal = l[keyName(p)];
  return typeof fromLocal === "string" && fromLocal ? fromLocal : null;
}

export async function setKey(api: typeof chrome, p: ProviderId, key: string, sessionOnly: boolean): Promise<void> {
  const k = key.trim();
  // Önce her iki konumdan da sil, sonra yalnızca seçilen yere yaz
  await api.storage.local.remove(keyName(p));
  await api.storage.session.remove(keyName(p));
  await (sessionOnly ? api.storage.session : api.storage.local).set({ [keyName(p)]: k });
}

export async function deleteKey(api: typeof chrome, p: ProviderId): Promise<void> {
  await api.storage.local.remove(keyName(p));
  await api.storage.session.remove(keyName(p));
}

export async function keyStatuses(api: typeof chrome): Promise<KeyStatus[]> {
  const out: KeyStatus[] = [];
  for (const p of PROVIDERS) {
    const s = (await api.storage.session.get(keyName(p)))[keyName(p)];
    const l = (await api.storage.local.get(keyName(p)))[keyName(p)];
    const key = (typeof s === "string" && s) || (typeof l === "string" && l) || null;
    out.push({ provider: p, hasKey: Boolean(key), masked: key ? maskKey(key) : null, sessionOnly: Boolean(s) });
  }
  return out;
}
