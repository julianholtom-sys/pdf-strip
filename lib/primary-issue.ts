type Ranked = {
  id: string;
  severity: "error" | "warning";
  field: string;
  message: string;
  found?: string;
};

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

function foldKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function uniqueIssues<T extends Ranked>(issues: T[]): T[] {
  const ranked = [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return (FIELD_RANK[a.field] ?? 50) - (FIELD_RANK[b.field] ?? 50);
  });
  const seen = new Set<string>();
  const out: T[] = [];
  for (const issue of ranked) {
    const keys = [issue.id, foldKey(issue.message)].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    out.push(issue);
  }
  return out;
}
