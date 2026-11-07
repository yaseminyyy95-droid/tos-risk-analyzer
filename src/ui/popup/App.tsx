import { useEffect, useState } from "preact/hooks";
import { Disclaimer } from "../components/Disclaimer";
import { tr } from "../i18n/tr";
import type { KeyStatus } from "../../shared/messages";
import { PROVIDER_LABEL } from "../../core/providers";

export function PopupApp({ api = globalThis.chrome }: { api?: typeof chrome }) {
  const [status, setStatus] = useState<{ provider: string; hasKey: boolean } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    void (async () => {
      const s = ((await api.storage.local.get("settings")).settings ?? {}) as { provider?: keyof typeof PROVIDER_LABEL };
      const provider = s.provider ?? "openai";
      const r = (await api.runtime.sendMessage({ type: "KEY_STATUS" })) as { statuses?: KeyStatus[] } | undefined;
      setStatus({ provider: PROVIDER_LABEL[provider], hasKey: Boolean(r?.statuses?.find((x) => x.provider === provider)?.hasKey) });
    })();
  }, [api]);

  const analyze = async () => {
    const [t] = await api.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) return setErr("Etkin sekme bulunamadı.");
    // sidePanel.open kullanıcı jestine bağlıdır: beklemeden çağrılır
    const opening = api.sidePanel.open({ tabId: t.id });
    await api.runtime.sendMessage({ type: "OPEN_PANEL_AND_ANALYZE", tabId: t.id });
    await opening.catch(() => setErr("Yan panel açılamadı."));
    window.close();
  };

  return (
    <div class="popup">
      <Disclaimer />
      <div class="wrap">
        <h1>{tr.appName}</h1>
        {status && (
          <p class="meta" data-cy="popup-provider">
            Sağlayıcı: {status.provider} · {status.hasKey ? "anahtar kayıtlı" : "anahtar yok"}
          </p>
        )}
        <button type="button" class="primary" data-cy="popup-analyze" onClick={() => void analyze()}>
          {tr.analyze}
        </button>
        <button type="button" onClick={() => void api.runtime.openOptionsPage()}>
          {tr.openOptions}
        </button>
        {err && <p class="toast">{err}</p>}
      </div>
    </div>
  );
}
