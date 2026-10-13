import type { BillCheckResult } from "@/lib/bill-types";

type Props = {
  results: BillCheckResult[];
  onCancel: () => void;
  onProceed: () => void;
};

export function BillCheckModal({ results, onCancel, onProceed }: Props) {
  const blocking = results.filter((row) => row.issues.some((issue) => issue.severity === "error"));
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
        <p className="muted">
          {blocking.length
            ? "Wipe is blocked on these files until the supply reference agrees with the address on the bill."
            : "The supply number matches the network for this postcode. Confirm and wipe if that is what you expected."}
        </p>
        <div className="modal-list">
          {results.map((row) => (
            <section key={row.fileId || row.fileName} className="modal-file">
              <h3>{row.fileName}</h3>
              {row.supplies.length ? (
                <p className="muted">
                  {row.supplies
                    .map((supply) =>
                      [supply.label, supply.value, supply.operator, supply.licenceArea]
                        .filter(Boolean)
                        .join(" · "),
                    )
                    .join(" | ")}
                </p>
              ) : null}
              {row.skipped ? <p className="muted">{row.skipped}</p> : null}
              {row.issues.length === 0 && !row.skipped ? (
                <p className="muted">Supply reference agrees with the bill address.</p>
              ) : null}
              <ul>
                {row.issues.map((issue) => (
                  <li key={issue.id} className={issue.severity === "error" ? "is-error" : "is-warning"}>
                    <strong>{issue.severity === "error" ? "Error" : "Check"}:</strong> {issue.message}
                    {issue.found ? <span> Found: {issue.found}.</span> : null}
                    {issue.expected ? <span> Expected: {issue.expected}.</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {!canProceed ? (
          <p className="muted">
            A meter or supply number that belongs to a different network cannot be rewritten from
            this tool. Correct the source bill, then check again.
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
