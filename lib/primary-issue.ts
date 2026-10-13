type Ranked = { severity: "error" | "warning"; field: string };

const FIELD_RANK: Record<string, number> = {
  lookup: 0,
  status: 1,
  number: 2,
  director: 3,
  identifier: 4,
  address: 5,
  name: 6,
  signatory: 7,
};

export function primaryIssue<T extends Ranked>(issues: T[]): T | undefined {
  if (!issues.length) return undefined;
  const errors = issues.filter((issue) => issue.severity === "error");
  const pool = errors.length ? errors : issues;
  return [...pool].sort((a, b) => (FIELD_RANK[a.field] ?? 50) - (FIELD_RANK[b.field] ?? 50))[0];
}
