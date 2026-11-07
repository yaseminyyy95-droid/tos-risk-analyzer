import { useEffect, useRef, useState } from "preact/hooks";
import type { VerifiedReport } from "../../core/schema";
import type { ProgressEvent, ProgressStage } from "../../core/types";
import { PORT_NAME, type ErrorCode, type SwToPanel } from "../../shared/messages";
import type { ProviderId } from "../../shared/types";
import { Disclaimer } from "../components/Disclaimer";
import { ReportView } from "../components/Report";
import { tr } from "../i18n/tr";
import { reportToJson, reportToMarkdown, downloadText } from "../export";

type View =
  | { kind: "idle" }
  | { kind: "running"; progress: ProgressEvent[] }
  | { kind: "report"; report: VerifiedReport; fromCache: boolean }
  | { kind: "error"; code: ErrorCode; message: string }
  | { kind: "consent"; provider: ProviderId; label: string }
  | { kind: "interrupted"; report: VerifiedReport | null };

const STAGES: ProgressStage[] = ["extracting", "sanitizing", "analyzing", "verifying", "done"];

export function SidePanelApp({ api = globalThis.chrome }: { api?: typeof chrome }) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [tab, setTab] = useState<{ id: number; title: string; url: string } | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [toast, setToast] = useState<string>("");
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    void api.storage.local.get("settings").then((r) => setDevMode(Boolean((r.settings as { developerMode?: boolean } | undefined)?.developerMode)));
    void api.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      if (cancelled || !t?.id) return;
      setTab({ id: t.id, title: t.title ?? "", url: t.url ?? "" });
      const port = api.runtime.connect({ name: PORT_NAME });
      portRef.current = port;
      port.onMessage.addListener((m: SwToPanel) => {
        switch (m.type) {
          case "STATE":
            if (m.state === "interrupted") setView({ kind: "interrupted", report: m.report });
            else if (m.report) setView({ kind: "report", report: m.report, fromCache: false });
            break;
          case "PROGRESS":
            setView((v) => ({ kind: "running", progress: [...(v.kind === "running" ? v.progress : []), m.event] }));
            break;
          case "REPORT":
            setView({ kind: "report", report: m.report, fromCache: m.fromCache });
            break;
          case "ERROR":
            setView({ kind: "error", code: m.code, message: m.message_tr });
            break;
          case "NEEDS_CONSENT":
            setView({ kind: "consent", provider: m.provider as ProviderId, label: m.providerLabel });
            break;
          case "HIGHLIGHT_RESULT":
            setToast(m.found ? "" : tr.quoteNotFoundInPage);
            break;
        }
      });
      port.postMessage({ type: "GET_STATE", tabId: t.id });
    });
    return () => {
      cancelled = true;
      portRef.current?.disconnect();
    };
  }, [api]);

  const analyze = (bypassCache = false) => {
    if (!tab) return;
    startedAt.current = Date.now();
    setToast("");
    setView({ kind: "running", progress: [] });
    portRef.current?.postMessage({ type: "ANALYZE_TAB", tabId: tab.id, bypassCache });
  };
  const show = (quote: string) => {
    if (!tab) return;
    portRef.current?.postMessage({ type: "HIGHLIGHT_QUOTE", tabId: tab.id, quote, lang: view.kind === "report" ? view.report.lang : null });
  };
  const exportAs = (fmt: "json" | "md") => {
    if (view.kind !== "report") return;
    const base = `tos-risk-${view.report.host || "rapor"}-${view.report.createdAt.slice(0, 10)}`;
    if (fmt === "json") downloadText(`${base}.json`, reportToJson(view.report), "application/json");
    else downloadText(`${base}.md`, reportToMarkdown(view.report), "text/markdown");
  };

  return (
    <div>
      <Disclaimer />
      {view.kind === "idle" && (
        <div class="wrap">
          <h1>{tr.appName}</h1>
          {tab && (
            <p class="muted" data-cy="tab-info">
              {tab.title}
            </p>
          )}
          <button type="button" class="primary" data-cy="analyze-btn" onClick={() => analyze(false)} disabled={!tab}>
            {tr.analyze}
          </button>
        </div>
      )}
      {view.kind === "running" && (
        <div class="wrap progress" data-cy="progress" aria-live="polite">
          <h2>Analiz sürüyor…</h2>
          <ol>
            {STAGES.map((s) => {
              const seen = view.progress.filter((p) => p.stage === s);
              const last = view.progress[view.progress.length - 1];
              const active = last?.stage === s;
              const done = !active && seen.length > 0;
              const extra = s === "analyzing" && seen.length ? ` (${seen[seen.length - 1]!.current}/${seen[seen.length - 1]!.total})` : "";
              return (
                <li key={s} class={active ? "active" : done ? "done" : ""}>
                  {tr.stages[s]}
                  {extra}
                  {done ? " ✓" : ""}
                </li>
              );
            })}
          </ol>
          <div>
            <button type="button" data-cy="cancel-btn" onClick={() => portRef.current?.postMessage({ type: "CANCEL" })}>
              {tr.cancel}
            </button>
          </div>
        </div>
      )}
      {view.kind === "consent" && (
        <div class="wrap" role="dialog" aria-labelledby="consent-title" data-cy="consent-dialog">
          <h2 id="consent-title">{tr.consentTitle}</h2>
          <p>{tr.consentBody(view.label)}</p>
          <div class="row">
            <button
              type="button"
              class="primary"
              data-cy="consent-accept"
              onClick={() => {
                portRef.current?.postMessage({ type: "GRANT_CONSENT", provider: view.provider });
                setTimeout(() => analyze(false), 50);
              }}
            >
              {tr.consentAccept}
            </button>
            <button type="button" data-cy="consent-decline" onClick={() => setView({ kind: "error", code: "CANCELLED", message: tr.consentDeclined })}>
              {tr.consentDecline}
            </button>
          </div>
        </div>
      )}
      {view.kind === "error" && (
        <div class="wrap" role="alert">
          <p data-cy="error-message">{view.message}</p>
          {view.code === "NO_API_KEY" ? (
            <button type="button" class="primary" data-cy="no-key-cta" onClick={() => void api.runtime.openOptionsPage()}>
              {tr.openOptions}
            </button>
          ) : (
            <button type="button" onClick={() => analyze(false)}>
              {tr.retry}
            </button>
          )}
        </div>
      )}
      {view.kind === "interrupted" && (
        <div class="wrap" role="alert" data-cy="interrupted">
          <p>{tr.interrupted}</p>
          <button type="button" class="primary" onClick={() => analyze(true)}>
            {tr.retry}
          </button>
        </div>
      )}
      {view.kind === "report" && (
        <>
          <ReportView report={view.report} developerMode={devMode} onShow={show} fromCache={view.fromCache} />
          <div class="wrap">
            {toast && (
              <p class="toast" role="status">
                {toast}
              </p>
            )}
            <div class="footer">
              <button type="button" data-cy="reanalyze-btn" onClick={() => analyze(true)}>
                {tr.reanalyze}
              </button>
              <button type="button" data-cy="export-json" onClick={() => exportAs("json")}>
                {tr.downloadJson}
              </button>
              <button type="button" data-cy="export-md" onClick={() => exportAs("md")}>
                {tr.downloadMd}
              </button>
            </div>
            <div class="meta" data-cy="report-meta">
              {view.report.provider} · {view.report.model} · prompt {view.report.promptVersion} · {(view.report.durationMs / 1000).toFixed(1)} sn
            </div>
          </div>
        </>
      )}
    </div>
  );
}
