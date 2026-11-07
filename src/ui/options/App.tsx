import { useEffect, useState } from "preact/hooks";
import { Disclaimer } from "../components/Disclaimer";
import { tr } from "../i18n/tr";
import type { KeyStatus } from "../../shared/messages";
import type { ProviderId, Settings } from "../../shared/types";
import { SUGGESTED_MODELS } from "../../core/providers/models";
import { PROVIDER_LABEL } from "../../core/providers";
import { normalizeSettings, SETTINGS_KEY } from "../../background/settings";

const PROVIDERS: ProviderId[] = ["openai", "anthropic", "groq"];

export function OptionsApp({ api = globalThis.chrome }: { api?: typeof chrome }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [statuses, setStatuses] = useState<KeyStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [global, setGlobal] = useState("");

  const refresh = async () => {
    const r = await api.storage.local.get(SETTINGS_KEY);
    setSettings(normalizeSettings(r[SETTINGS_KEY]));
    const st = (await api.runtime.sendMessage({ type: "KEY_STATUS" })) as { statuses?: KeyStatus[] } | undefined;
    setStatuses(st?.statuses ?? []);
  };
  useEffect(() => void refresh(), []);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = normalizeSettings({ ...settings, ...patch, models: { ...settings.models, ...(patch.models ?? {}) } });
    await api.storage.local.set({ [SETTINGS_KEY]: next });
    setSettings(next);
  };

  const setKeyFor = async (p: ProviderId) => {
    const key = (drafts[p] ?? "").trim();
    if (key.length < 8) return setMsg({ ...msg, [p]: "Anahtar çok kısa." });
    const r = (await api.runtime.sendMessage({ type: "SET_KEY", provider: p, key, sessionOnly: settings?.sessionOnlyKeys ?? false })) as { ok: boolean } | undefined;
    setDrafts({ ...drafts, [p]: "" });
    setMsg({ ...msg, [p]: r?.ok ? "Kaydedildi." : "Kaydedilemedi." });
    await refresh();
  };
  const testKey = async (p: ProviderId) => {
    setMsg({ ...msg, [p]: "Test ediliyor…" });
    const r = (await api.runtime.sendMessage({ type: "TEST_KEY", provider: p })) as { ok: boolean; message_tr: string } | undefined;
    setMsg({ ...msg, [p]: r?.message_tr ?? "Test başarısız." });
  };
  const delKey = async (p: ProviderId) => {
    await api.runtime.sendMessage({ type: "DELETE_KEY", provider: p });
    setMsg({ ...msg, [p]: "Silindi." });
    await refresh();
  };
  const toggleAuto = async (on: boolean) => {
    if (on) {
      const granted = await api.permissions.request({ origins: ["<all_urls>"] }).catch(() => false);
      if (!granted) return setGlobal("İzin verilmediği için otomatik algılama açılmadı.");
    } else {
      await api.permissions.remove({ origins: ["<all_urls>"] }).catch(() => false);
    }
    await save({ autoDetect: on });
  };

  if (!settings) return <Disclaimer />;
  return (
    <div>
      <Disclaimer />
      <main class="wrap" style={{ maxWidth: "760px" }}>
        <h1>{tr.appName} — Ayarlar</h1>
        <p class="card" data-cy="key-privacy-note">
          Anahtar tarayıcınızda şifrelenmeden saklanır; yalnızca seçtiğiniz sağlayıcıya gönderilir. Sayfa metni, analiz başlattığınızda seçili sağlayıcıya gönderilir.
        </p>
        <section class="card">
          <h2>Sağlayıcı</h2>
          <div class="field">
            <label for="provider">Etkin sağlayıcı</label>
            <select id="provider" value={settings.provider} onChange={(e) => void save({ provider: (e.target as HTMLSelectElement).value as ProviderId })}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <label class="row">
            <input type="checkbox" checked={settings.sessionOnlyKeys} onChange={(e) => void save({ sessionOnlyKeys: (e.target as HTMLInputElement).checked })} />
            Anahtarı sadece bu oturumda sakla (tarayıcı kapanınca silinir; yeni kaydedilen anahtarlar için geçerlidir)
          </label>
        </section>
        {PROVIDERS.map((p) => {
          const st = statuses.find((s) => s.provider === p);
          return (
            <section class="card" key={p} data-cy={`provider-${p}`}>
              <h2>{PROVIDER_LABEL[p]}</h2>
              <p class="meta">
                {st?.hasKey ? `Kayıtlı anahtar: ${st.masked}${st.sessionOnly ? " (yalnızca bu oturum)" : ""}` : "Kayıtlı anahtar yok."}
              </p>
              <div class="field">
                <label for={`key-${p}`}>API anahtarı</label>
                <div class="row">
                  <input
                    id={`key-${p}`}
                    type={reveal[p] ? "text" : "password"}
                    autocomplete="off"
                    spellcheck={false}
                    value={drafts[p] ?? ""}
                    onInput={(e) => setDrafts({ ...drafts, [p]: (e.target as HTMLInputElement).value })}
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={() => setReveal({ ...reveal, [p]: !reveal[p] })}>
                    {reveal[p] ? "Gizle" : "Göster"}
                  </button>
                </div>
              </div>
              <div class="row">
                <button type="button" class="primary" onClick={() => void setKeyFor(p)}>
                  Kaydet
                </button>
                <button type="button" onClick={() => void testKey(p)} disabled={!st?.hasKey}>
                  Anahtarı test et
                </button>
                <button type="button" onClick={() => void delKey(p)} disabled={!st?.hasKey}>
                  Sil
                </button>
                {msg[p] && <span class="meta">{msg[p]}</span>}
              </div>
              <div class="field" style={{ marginTop: "10px" }}>
                <label for={`model-${p}`}>Model</label>
                <input
                  id={`model-${p}`}
                  type="text"
                  list={`models-${p}`}
                  value={settings.models[p]}
                  onChange={(e) => void save({ models: { ...settings.models, [p]: (e.target as HTMLInputElement).value } })}
                />
                <datalist id={`models-${p}`}>
                  {SUGGESTED_MODELS[p].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <small class="muted">Öneri listesi zamanla eskiyebilir; sağlayıcının güncel model adını yazabilirsiniz.</small>
              </div>
            </section>
          );
        })}
        <section class="card">
          <h2>Diğer</h2>
          <label class="row">
            <input type="checkbox" checked={settings.autoDetect} onChange={(e) => void toggleAuto((e.target as HTMLInputElement).checked)} />
            Hukuki sayfaları otomatik algıla (tüm sitelere erişim izni ister; yalnızca rozet gösterir, analiz yine sizin onayınızla başlar)
          </label>
          <label class="row">
            <input type="checkbox" checked={settings.developerMode} onChange={(e) => void save({ developerMode: (e.target as HTMLInputElement).checked })} />
            Geliştirici modu (reddedilen iddiaların sebeplerini göster)
          </label>
          <div class="row" style={{ marginTop: "8px" }}>
            <button
              type="button"
              onClick={async () => {
                await api.runtime.sendMessage({ type: "CLEAR_CACHE" });
                setGlobal("Önbellek temizlendi.");
              }}
            >
              Önbelleği temizle
            </button>
            <button type="button" onClick={() => void save({ consent: {} })}>
              Gizlilik onaylarını sıfırla
            </button>
            {global && <span class="meta">{global}</span>}
          </div>
        </section>
      </main>
    </div>
  );
}
