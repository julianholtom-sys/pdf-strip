export type BillIdentifierKind = "mpan" | "mprn" | "spid";

export type ExtractedBill = {
  fileId?: string;
  fileName: string;
  mpans: string[];
  mprns: string[];
  spids: string[];
  postcodes: string[];
  addressHints: string[];
};

export type BillIssue = {
  id: string;
  field: "identifier" | "address" | "lookup";
  severity: "error" | "warning";
  message: string;
  found?: string;
  expected?: string;
  fixable?: boolean;
};

export type SupplyRecord = {
  kind: BillIdentifierKind;
  value: string;
  label: string;
  operator: string;
  licenceArea: string;
};

export type BillCheckResult = {
  fileId?: string;
  fileName: string;
  skipped?: string;
  supplies: SupplyRecord[];
  issues: BillIssue[];
  ok: boolean;
};
