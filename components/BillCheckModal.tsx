import type { BillCheckResult } from "@/lib/bill-types";
import { uniqueIssues } from "@/lib/primary-issue";

type Props = {
  results: BillCheckResult[];
  onCancel: () => void;
  onProceed: () => void;
};

export function BillCheckModal({ results, onCancel, onProceed }: Props) {
  const blocking = results.filter((row) => row.issues.some((issue) => issue.severity === "error"));
  const files = results
    .map((row) => ({ row, issues: uniqueIssues(row.issues) }))
    .filter((entry) => entry.issues.length);
  const canProceed = results.every((row) => !row.issues.some((issue) => issue.severity === "error"));
  const title = blocking.length ? "Bill details need addressing" : "Confirm before wiping";
  const blockedLabel = files.length > 1 ? "these files are" : "this file is";

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
            Only {blockedLabel} blocked. Other files that passed have been cleaned. Correct the
            source, then check again.
          </p>
        ) : (
          <p className="muted">
            This check uses the official MPAN check digit and the distribution network for the
            printed postcode. It does not replace an industry meter-point enquiry.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={onProceed} disabled={!canProceed}>
            Confirm and wipe
          </button>
        </div>
      </div>
    </div>
  );
}
