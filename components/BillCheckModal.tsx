import type { BillCheckResult } from "@/lib/bill-types";
import { primaryIssue } from "@/lib/primary-issue";

type Props = {
  results: BillCheckResult[];
  onCancel: () => void;
  onProceed: () => void;
};

export function BillCheckModal({ results, onCancel, onProceed }: Props) {
  const blocking = results.filter((row) => row.issues.some((issue) => issue.severity === "error"));
  const shown = results
    .map((row) => ({ row, issue: primaryIssue(row.issues) }))
    .filter((entry) => entry.issue);
  const canProceed = results.every((row) => !row.issues.some((issue) => issue.severity === "error"));
  const title = blocking.length ? "Bill details need addressing" : "Confirm before wiping";

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
            <p className="muted">Supply reference agrees with the bill address.</p>
          )}
        </div>
        {!canProceed ? (
          <p className="muted">Correct the source bill, then check again.</p>
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
