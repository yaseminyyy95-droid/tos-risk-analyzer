import type { Settings, ProviderId } from "../shared/types";
import { DEFAULT_MODELS } from "../core/providers/models";

export const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  models: { ...DEFAULT_MODELS },
  sessionOnlyKeys: false,
  autoDetect: false,
  developerMode: false,
  consent: {},
};

const PROVIDERS: ProviderId[] = ["openai", "anthropic", "groq"];

export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const provider = PROVIDERS.includes(s.provider as ProviderId) ? (s.provider as ProviderId) : DEFAULT_SETTINGS.provider;
  const models = { ...DEFAULT_SETTINGS.models };
  for (const p of PROVIDERS) {
    const m = s.models?.[p];
    if (typeof m === "string" && m.trim() && m.length <= 100) models[p] = m.trim();
  }
  const consent: Settings["consent"] = {};
  for (const p of PROVIDERS) if (s.consent?.[p] === true) consent[p] = true;
  return {
    provider,
    models,
    sessionOnlyKeys: s.sessionOnlyKeys === true,
    autoDetect: s.autoDetect === true,
    developerMode: s.developerMode === true,
    consent,
  };
}

export async function loadSettings(api: typeof chrome): Promise<Settings> {
  const r = await api.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(r[SETTINGS_KEY]);
}

export async function saveSettings(api: typeof chrome, patch: Partial<Settings>): Promise<Settings> {
  const cur = await loadSettings(api);
  const next = normalizeSettings({ ...cur, ...patch, models: { ...cur.models, ...(patch.models ?? {}) }, consent: { ...cur.consent, ...(patch.consent ?? {}) } });
  await api.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
