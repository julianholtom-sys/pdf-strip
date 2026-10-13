import type { BillCheckResult } from "@/lib/bill-types";
import { uniqueIssues } from "@/lib/primary-issue";

type Props = {
  results: BillCheckResult[];
  applying?: boolean;
  onCancel: () => void;
  onProceed: () => void;
};

export function BillCheckModal({ results, applying, onCancel, onProceed }: Props) {
  const blocking = results.filter((row) => row.issues.some((issue) => issue.severity === "error"));
  const files = results
    .map((row) => ({ row, issues: uniqueIssues(row.issues) }))
    .filter((entry) => entry.issues.length);
  const canProceed = results.some((row) => {
    const errors = row.issues.filter((issue) => issue.severity === "error");
    return errors.length === 0 || errors.every((issue) => issue.fixable);
  });
  const fixable =
    canProceed && results.some((row) => row.issues.some((issue) => issue.fixable && issue.expected));
  const title = blocking.length ? "Bill details need addressing" : "Confirm before wiping";
  const blockedLabel = files.length > 1 ? "these files are" : "this file is";
  const proceedLabel = applying
    ? "Applying…"
    : fixable
      ? "Apply supply number and wipe"
      : "Confirm and wipe";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-check-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="bill-check-title">{title}</h2>
        <div className="modal-list">
          {files.length ? (
            files.map(({ row, issues }) => (
              <section key={row.fileId || row.fileName} className="modal-file">
                <h3>{row.fileName}</h3>
                {issues.map((issue) => (
                  <div key={issue.id} className="issue-block">
                    <p className={issue.severity === "error" ? "issue-error" : "issue-warning"}>
                      {issue.message}
                    </p>
                    {issue.correction ? (
                      <p className="issue-fix">
                        <strong>Correction:</strong> {issue.correction}
                      </p>
                    ) : null}
                  </div>
                ))}
              </section>
            ))
          ) : (
            <p className="muted">Supply reference agrees with the bill address.</p>
          )}
        </div>
        {!canProceed ? (
          <p className="muted">
            Only {blockedLabel} blocked. Other files that passed have been cleaned. A meter
            number that cannot be derived from the postcode has to come from the supplier.
          </p>
        ) : fixable ? (
          <p className="muted">
            This updates the printed MPAN using this file’s type size and position where
            possible, then strips metadata. Only do this on drafts you are allowed to edit.
          </p>
        ) : (
          <p className="muted">
            This check uses the official MPAN check digit and the distribution network for the
            printed postcode. It does not replace an industry meter-point enquiry.
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
