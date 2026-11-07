import type { ReportStatus, VerifiedFinding, VerifiedReport } from "../../core/schema";
import { CATEGORY_INFO, SEVERITY_TR } from "../../core/categories";
import { STATUS_LABEL_TR } from "../../core/status";
import { tr } from "../i18n/tr";

export function StatusBadge({ status, reasons }: { status: ReportStatus; reasons: string[] }) {
  return (
    <section class="card" aria-label="Durum">
      <span class={`badge ${status}`} data-cy="status-badge">
        {STATUS_LABEL_TR[status]}
      </span>
      <ul class="reasons" data-cy="status-reasons">
        {reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </section>
  );
}

export function ScoreGauge({ report }: { report: VerifiedReport }) {
  return (
    <section class="card" aria-label="Risk skoru">
      <div class="gauge">
        <span class={`num lvl-${report.level}`} data-cy="risk-score" aria-label={`Risk skoru ${report.score} / 100`}>
          {report.score}
        </span>
        <div style={{ flex: 1 }}>
          <div class={`lvl-${report.level}`} data-cy="risk-level">
            <strong>{report.level}</strong> <span class="muted">/ 100</span>
          </div>
          <div class="bar" role="presentation">
            <div class={`fill lvl-${report.level}`} style={{ width: `${report.score}%` }} />
          </div>
        </div>
      </div>
      <small class="muted">{tr.scoreNote}</small>
      {report.llmSuggestedScore !== null && (
        <div class="meta" data-cy="llm-score">
          {tr.llmScoreNote(report.llmSuggestedScore)}
        </div>
      )}
    </section>
  );
}

export function InjectionAlert({ report, onShow }: { report: VerifiedReport; onShow: (q: string) => void }) {
  const inj = report.injection;
  const show = inj.heuristicFlaggedSegments.length > 0 || inj.llmSuspected || inj.hiddenBlocksWithInstructions > 0;
  if (!show) {
    if (inj.hiddenBlocksRemoved > 0)
      return (
        <p class="meta" data-cy="hidden-note">
          {tr.hiddenBlocks(inj.hiddenBlocksRemoved, 0)}
        </p>
      );
    return null;
  }
  return (
    <section class="alert" role="alert" data-cy="injection-alert">
      <strong>⚠️ {tr.injectionTitle}</strong>
      <p style={{ margin: "6px 0" }} data-cy="hidden-blocks">
        {tr.hiddenBlocks(inj.hiddenBlocksRemoved, inj.hiddenBlocksWithInstructions)}
      </p>
      {inj.heuristicFlaggedSegments.length > 0 && <p style={{ margin: "6px 0" }}>{tr.flaggedSegments(inj.heuristicFlaggedSegments.length)}</p>}
      {inj.flaggedPreviews.map((p, i) => (
        <pre key={i} data-cy="flagged-preview">
          {p.slice(0, 200)}
        </pre>
      ))}
      {inj.modelPossiblyInfluenced && <p style={{ margin: "6px 0" }}>{tr.modelInfluenced}</p>}
      {report.manipulativeFindings.length > 0 && (
        <div>
          <p style={{ margin: "6px 0" }}>{tr.manipulativeQuotes}</p>
          {report.manipulativeFindings.map((f) => (
            <blockquote key={f.id} lang={report.lang ?? undefined}>
              {f.quote}
              <div>
                <button type="button" onClick={() => onShow(f.quote)}>
                  {tr.showInPage}
                </button>
              </div>
            </blockquote>
          ))}
        </div>
      )}
    </section>
  );
}

export function FindingCard({ f, lang, onShow }: { f: VerifiedFinding; lang: string | null; onShow: (q: string) => void }) {
  return (
    <article class="card finding" data-cy="finding-card" aria-label={f.title_tr}>
      <div class="row">
        <span class={`chip sev-${f.severity}`} data-cy="finding-severity">
          {SEVERITY_TR[f.severity]}
        </span>
        <span class="chip" data-cy="finding-category">
          {CATEGORY_INFO[f.category].label_tr}
        </span>
        {f.matchTier !== "exact" && (
          <span class="meta" data-cy="match-tier">
            {f.matchTier === "normalized" ? tr.normalizedMatch : tr.caseMatch}
          </span>
        )}
        {f.languageWarning && <span class="meta">{tr.languageWarning}</span>}
      </div>
      <h3>{f.title_tr}</h3>
      <p style={{ margin: "4px 0" }}>{f.explanation_tr}</p>
      <blockquote lang={lang ?? undefined} data-cy="finding-quote">
        {f.quote}
      </blockquote>
      <div class="row">
        <button type="button" data-cy="show-in-page" onClick={() => onShow(f.quote)}>
          {tr.showInPage}
        </button>
        {f.headingPath.length > 0 && <span class="meta">{f.headingPath.join(" › ")}</span>}
      </div>
    </article>
  );
}

export function RejectedSummary({ report, developerMode }: { report: VerifiedReport; developerMode: boolean }) {
  if (report.rejectedCount === 0)
    return (
      <p class="card" data-cy="rejected-summary">
        {tr.allVerified}
      </p>
    );
  const parts = Object.entries(report.rejectedReasons).map(([k, n]) => `${n}: ${tr.rejectReasons[k] ?? k}`);
  return (
    <section class="card" data-cy="rejected-summary">
      <p style={{ margin: 0 }}>{tr.rejected(report.rejectedCount)}</p>
      <small class="muted">{parts.join(" · ")}</small>
      {developerMode && (
        <details data-cy="rejected-details">
          <summary>{tr.developer}</summary>
          <ul>
            {report.rejectedDetails.map((d, i) => (
              <li key={i}>
                {tr.rejectReasons[d.reason] ?? d.reason} — {CATEGORY_INFO[d.category as keyof typeof CATEGORY_INFO]?.label_tr ?? d.category}
                {d.closestMatchPreview ? ` — en yakın kaynak parçası: "${d.closestMatchPreview}"` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function SentinelHints({ report }: { report: VerifiedReport }) {
  if (!report.sentinelHints.length) return null;
  return (
    <section class="hints" data-cy="sentinel-hints">
      <strong>{tr.sentinelTitle}</strong>
      <p style={{ margin: "4px 0" }}>{tr.sentinelNote}</p>
      <ul>
        {report.sentinelHints.map((h, i) => (
          <li key={i}>
            <em>{CATEGORY_INFO[h.category].label_tr}</em>: <span lang={report.lang ?? undefined}>{h.matchedText}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReportView(props: { report: VerifiedReport; developerMode: boolean; onShow: (q: string) => void; fromCache: boolean }) {
  const { report, onShow } = props;
  return (
    <div class="wrap" data-cy="report">
      <header>
        <h1 data-cy="page-title">{report.title || report.host}</h1>
        <div class="meta">
          {report.host} · {tr.docTypes[report.documentType] ?? report.documentType}
        </div>
        {report.legalPageConfidence < 0.4 && <p class="toast">{tr.lowLegalConfidence}</p>}
        {props.fromCache && <p class="meta">{tr.fromCache}</p>}
      </header>
      <StatusBadge status={report.status} reasons={report.statusReasons_tr} />
      {report.status !== "FAILED" && <ScoreGauge report={report} />}
      <InjectionAlert report={report} onShow={onShow} />
      {report.summary_tr && (
        <section>
          <h2>{tr.summary}</h2>
          <p style={{ margin: 0 }} data-cy="summary">
            {report.summary_tr}
          </p>
        </section>
      )}
      {report.status !== "FAILED" && (
        <section aria-label={tr.findings}>
          <h2>
            {tr.findings} ({report.findings.length})
          </h2>
          {report.findings.length === 0 && <p class="muted">{tr.noFindings}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {report.findings.map((f) => (
              <FindingCard key={f.id} f={f} lang={report.lang} onShow={onShow} />
            ))}
          </div>
        </section>
      )}
      {report.status !== "FAILED" && <RejectedSummary report={report} developerMode={props.developerMode} />}
      <SentinelHints report={report} />
      {report.uncertaintyNotes_tr && (
        <section>
          <h2>{tr.uncertainty}</h2>
          <p style={{ margin: 0 }}>{report.uncertaintyNotes_tr}</p>
        </section>
      )}
    </div>
  );
}
