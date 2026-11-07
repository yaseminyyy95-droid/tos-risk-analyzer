import { tr } from "../i18n/tr";

/** Kapatılamaz, sabit hukuki uyarı. */
export function Disclaimer() {
  return (
    <div class="disclaimer" role="note" data-cy="legal-disclaimer">
      <span aria-hidden="true">⚖️</span>
      <div>
        <strong>{tr.disclaimerTitle}</strong>
        <small>{tr.disclaimerSub}</small>
      </div>
    </div>
  );
}
