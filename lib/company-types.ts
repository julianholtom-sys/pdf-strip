export type ExtractedCompany = {
  fileId?: string;
  fileName: string;
  numbers: string[];
  names: string[];
  postcodes: string[];
  addressHints: string[];
  directors: string[];
  signatories: string[];
};

export type TextRun = {
  str: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Issue = {
  id: string;
  field: "number" | "address" | "director" | "signatory" | "name" | "status" | "lookup";
  severity: "error" | "warning";
  message: string;
  correction?: string;
  found?: string;
  expected?: string;
  fixable?: boolean;
};

export type Officer = {
  name: string;
  role: string;
  resigned: boolean;
};

export type CompanyRecord = {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  companyStatusDetail?: string;
  live: boolean;
  statusLabel: string;
  address: string;
  addressLines: string[];
  postalCode: string;
  officers: Officer[];
};

export type CheckResult = {
  fileId?: string;
  fileName: string;
  skipped?: string;
  company?: CompanyRecord;
  companies?: CompanyRecord[];
  issues: Issue[];
  ok: boolean;
};
