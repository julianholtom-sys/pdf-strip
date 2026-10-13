import type { CheckResult } from "@/lib/company-types";
import { primaryIssue } from "@/lib/primary-issue";

type Props = {
  results: CheckResult[];
  applying: boolean;
  onCancel: () => void;
  onProceed: () => void;
};

export function CompanyCheckModal({ results, applying, onCancel, onProceed }: Props) {
  const blocking = results.filter((row) => row.issues.some((issue) => issue.severity === "error"));
  const shown = results
    .map((row) => ({ row, issue: primaryIssue(row.issues) }))
    .filter((entry) => entry.issue);
  const primary = shown[0]?.issue;
  const fixable = Boolean(primary?.fixable && primary.expected);
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
        <div className="modal-list">
          {shown.length ? (
            shown.slice(0, 1).map(({ row, issue }) => (
              <section key={row.fileId || row.fileName} className="modal-file">
                <h3>{row.fileName}</h3>
                <p className={issue?.severity === "error" ? "issue-error" : "issue-warning"}>
                  {issue?.message}
                </p>
                {issue?.correction ? (
                  <p className="issue-fix">
                    <strong>Correction:</strong> {issue.correction}
                  </p>
                ) : null}
              </section>
            ))
          ) : (
            <p className="muted">Matches Companies House.</p>
          )}
        </div>
        {!canProceed ? (
          <p className="muted">
            Only this file is blocked. Other files that passed have been cleaned. Correct this
            file, then check again. Signatures are never drawn on.
          </p>
        ) : fixable ? (
          <p className="muted">
            This updates the printed number or registered office from the official record, then
            strips metadata. Signatures are never drawn on.
          </p>
        ) : (
          <p className="muted">Confirm they are authorised if you want to wipe. Signatures are never drawn on.</p>
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
