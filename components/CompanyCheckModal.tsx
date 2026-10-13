import type { CheckResult } from "@/lib/company-types";

type Props = {
  results: CheckResult[];
  applying: boolean;
  onCancel: () => void;
  onProceed: () => void;
};

export function CompanyCheckModal({ results, applying, onCancel, onProceed }: Props) {
  const blocking = results.filter((row) => row.issues.some((issue) => issue.severity === "error"));
  const fixable = results.some((row) => row.issues.some((issue) => issue.fixable && issue.expected));
  const canProceed = results.some((row) => {
    const errors = row.issues.filter((issue) => issue.severity === "error");
    return errors.length === 0 || errors.every((issue) => issue.fixable);
  });
  const title = blocking.length
    ? "Company details need addressing"
    : "Confirm before wiping";
  const proceedLabel = applying
    ? "Applying…"
    : fixable
      ? "Apply Companies House details and wipe"
      : "Confirm and wipe";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ch-check-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="ch-check-title">{title}</h2>
        <p className="muted">
          {blocking.length
            ? "Wipe is blocked until every named company is live at Companies House and the registered details match, or you apply the official record."
            : "A signatory does not match a current Companies House officer. Confirm they are authorised if you want to wipe."}
        </p>
        <div className="modal-list">
          {results.map((row) => (
            <section key={row.fileId || row.fileName} className="modal-file">
              <h3>{row.fileName}</h3>
              {(row.companies?.length ? row.companies : row.company ? [row.company] : []).map(
                (company) => (
                  <p key={company.companyNumber} className="muted">
                    {company.companyName} · {company.companyNumber}
                    {company.statusLabel ? ` · ${company.statusLabel}` : ""}
                    {company.address ? ` · ${company.address}` : ""}
                  </p>
                ),
              )}
              {row.skipped ? <p className="muted">{row.skipped}</p> : null}
              {row.issues.length === 0 && !row.skipped ? (
                <p className="muted">Matches Companies House.</p>
              ) : null}
              <ul>
                {row.issues.map((issue) => (
                  <li key={issue.id} className={issue.severity === "error" ? "is-error" : "is-warning"}>
                    <strong>{issue.severity === "error" ? "Error" : "Check"}:</strong> {issue.message}
                    {issue.found ? <span> Found: {issue.found}.</span> : null}
                    {issue.expected ? <span> Companies House: {issue.expected}.</span> : null}
                    {issue.fixable ? <span> This can be updated from the official record.</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {!canProceed ? (
          <p className="muted">
            Director, liquidation, dissolved, or missing-company issues cannot be rewritten
            automatically. Correct the source file, then check again. Signatures are never drawn on.
          </p>
        ) : (
          <p className="muted">
            Applying a fix updates printed number and registered office using this file’s type
            size and position where possible, then strips metadata. Only do this on drafts you
            are allowed to edit. Signatures are never drawn on.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onCancel} disabled={applying}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={onProceed} disabled={applying || !canProceed}>
            {proceedLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
