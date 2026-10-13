import { foldCompanyText, foldPostcode } from "./company-parse";
import type {
  CheckResult,
  CompanyRecord,
  ExtractedCompany,
  Issue,
  Officer,
} from "./company-types";

const CH_ROOT = "https://api.company-information.service.gov.uk";

type ChAddress = {
  address_line_1?: string;
  address_line_2?: string;
  care_of?: string;
  country?: string;
  locality?: string;
  po_box?: string;
  postal_code?: string;
  premises?: string;
  region?: string;
};

type ChProfile = {
  company_name?: string;
  company_number?: string;
  company_status?: string;
  company_status_detail?: string;
  registered_office_address?: ChAddress;
};

type ChSearchItem = {
  company_number?: string;
  title?: string;
  company_status?: string;
};

const LIVE_STATUSES = new Set(["active", "open", "registered"]);

const STATUS_LABELS: Record<string, string> = {
  active: "active",
  dissolved: "dissolved",
  liquidation: "in liquidation",
  receivership: "in receivership",
  administration: "in administration",
  "voluntary-arrangement": "in a voluntary arrangement",
  "converted-closed": "converted/closed",
  "insolvency-proceedings": "in insolvency proceedings",
  registered: "registered",
  removed: "removed",
  closed: "closed",
  open: "open",
};

const STATUS_DETAIL_LABELS: Record<string, string> = {
  "active-proposal-to-strike-off": "proposal to strike off",
  "petition-to-restore-dissolved": "petition to restore",
  "transferred-from-uk": "transferred from the UK",
  "transformed-to-se": "transformed to an SE",
  "converted-to-plc": "converted to a PLC",
};

export function isLiveCompanyStatus(status: string) {
  return LIVE_STATUSES.has((status || "").trim().toLowerCase());
}

export function companyStatusLabel(status: string, detail = "") {
  const key = (status || "").trim().toLowerCase();
  const base = STATUS_LABELS[key] || key.replace(/-/g, " ") || "unknown status";
  const extraKey = (detail || "").trim().toLowerCase();
  const extra = extraKey ? STATUS_DETAIL_LABELS[extraKey] || extraKey.replace(/-/g, " ") : "";
  if (extra && isLiveCompanyStatus(key)) return `${base}, with a ${extra}`;
  if (extra) return `${base} (${extra})`;
  return base;
}

type ChOfficer = {
  name?: string;
  officer_role?: string;
  resigned_on?: string;
};

function authHeader(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function chGet<T>(path: string, key: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await fetch(`${CH_ROOT}${path}`, {
    headers: {
      Authorization: authHeader(key),
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, data: (await response.json()) as T };
}

function formatAddress(address: ChAddress | undefined) {
  if (!address) return { text: "", lines: [] as string[], postalCode: "" };
  const lines = [
    address.care_of,
    address.po_box,
    [address.premises, address.address_line_1].filter(Boolean).join(" "),
    address.address_line_2,
    address.locality,
    address.region,
    address.postal_code,
    address.country,
  ]
    .map((line) => (line || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return {
    text: lines.join(", "),
    lines,
    postalCode: (address.postal_code || "").toUpperCase(),
  };
}

function officerNatural(name: string) {
  const match = name.match(/^([^,]+),\s*(.+)$/);
  if (match) return `${match[2]} ${match[1]}`.replace(/\s+/g, " ").trim();
  return name.replace(/\s+/g, " ").trim();
}

function namesOverlap(a: string, b: string) {
  const left = foldCompanyText(a).split(" ").filter((part) => part.length > 1);
  const right = foldCompanyText(b).split(" ").filter((part) => part.length > 1);
  if (!left.length || !right.length) return false;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.every((part) => long.includes(part));
}

const SEARCH_NOISE = new Set([
  "DISSOLVED",
  "LIQUIDATION",
  "ADMINISTRATION",
  "RECEIVERSHIP",
  "STRIKEOFF",
  "STRIKE",
  "OFF",
]);

function foldListedName(value: string) {
  return foldCompanyText(value)
    .split(" ")
    .filter((part) => part.length > 1 && !SEARCH_NOISE.has(part))
    .join(" ");
}

async function loadCompany(number: string, key: string): Promise<CompanyRecord | null> {
  const profile = await chGet<ChProfile>(`/company/${encodeURIComponent(number)}`, key);
  if (!profile.ok) return null;
  const officersRes = await chGet<{ items?: ChOfficer[] }>(
    `/company/${encodeURIComponent(number)}/officers?items_per_page=100`,
    key,
  );
  const officers: Officer[] = (officersRes.ok ? officersRes.data.items || [] : []).map((row) => ({
    name: officerNatural(row.name || ""),
    role: row.officer_role || "",
    resigned: Boolean(row.resigned_on),
  }));
  const address = formatAddress(profile.data.registered_office_address);
  const companyStatus = profile.data.company_status || "";
  const companyStatusDetail = profile.data.company_status_detail || "";
  return {
    companyNumber: (profile.data.company_number || number).toUpperCase(),
    companyName: profile.data.company_name || "",
    companyStatus,
    companyStatusDetail,
    live: isLiveCompanyStatus(companyStatus),
    statusLabel: companyStatusLabel(companyStatus, companyStatusDetail),
    address: address.text,
    addressLines: address.lines,
    postalCode: address.postalCode,
    officers,
  };
}

function pickSearchHit(name: string, items: ChSearchItem[]): ChSearchItem | "ambiguous" | null {
  const withNumbers = items.filter((row) => row.company_number);
  if (!withNumbers.length) return null;
  const folded = foldListedName(name);
  const exact = withNumbers.filter((row) => foldListedName(row.title || "") === folded);
  const pool = exact.length
    ? exact
    : withNumbers.filter((row) => namesOverlap(name, foldListedName(row.title || "")));
  if (!pool.length) return null;
  const live = pool.filter((row) => isLiveCompanyStatus(row.company_status || ""));
  if (live.length === 1) return live[0];
  if (live.length > 1) return "ambiguous";
  if (pool.length === 1) return pool[0];
  if (exact.length === 1) return exact[0];
  return "ambiguous";
}

async function searchCompany(
  name: string,
  key: string,
): Promise<{ kind: "found"; number: string } | { kind: "ambiguous" } | { kind: "none" }> {
  const result = await chGet<{ items?: ChSearchItem[] }>(
    `/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`,
    key,
  );
  if (!result.ok || !result.data.items?.length) return { kind: "none" };
  const hit = pickSearchHit(name, result.data.items);
  if (hit === "ambiguous") return { kind: "ambiguous" };
  if (!hit?.company_number) return { kind: "none" };
  return { kind: "found", number: hit.company_number };
}

function uniqueNumbers(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toUpperCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function activeOfficers(companies: CompanyRecord[]) {
  return companies.flatMap((company) =>
    company.officers
      .filter((officer) => !officer.resigned)
      .map((officer) => ({ ...officer, companyName: company.companyName })),
  );
}

function officerHit(
  person: string,
  officers: { name: string; companyName: string }[],
) {
  return officers.find((officer) => namesOverlap(person, officer.name));
}

function compare(extracted: ExtractedCompany, companies: CompanyRecord[]): Issue[] {
  const issues: Issue[] = [];
  const officers = activeOfficers(companies);
  const officerSummary = officers
    .slice(0, 12)
    .map((officer) => `${officer.name} (${officer.companyName})`)
    .join("; ");

  for (const company of companies) {
    if (!company.live) {
      issues.push({
        id: `status-${company.companyNumber}`,
        field: "status",
        severity: "error",
        message: `${company.companyName} (${company.companyNumber}) is not a live company. Companies House lists it as ${company.statusLabel}.`,
        correction: `Replace this party with a company that is active on Companies House. ${company.statusLabel} cannot be rewritten automatically.`,
        found: company.statusLabel,
        expected: "active",
      });
    } else if (/proposal to strike off/i.test(company.statusLabel)) {
      issues.push({
        id: `strike-off-${company.companyNumber}`,
        field: "status",
        severity: "warning",
        message: `${company.companyName} is still live at Companies House but has a proposal to strike off.`,
        correction: "Confirm you still want this party, or replace it before it is struck off.",
        found: company.statusLabel,
      });
    }
  }

  const docPostcodes = extracted.postcodes.map(foldPostcode);
  const addressBlob = foldCompanyText(
    [...extracted.addressHints, ...extracted.postcodes, extracted.fileName].join(" "),
  );
  for (const company of companies) {
    if (!company.live) continue;
    const chPost = foldPostcode(company.postalCode);
    const lineHits = company.addressLines.some((line) => {
      const folded = foldCompanyText(line);
      return folded.length > 4 && addressBlob.includes(folded);
    });
    if (chPost && !docPostcodes.includes(chPost) && !lineHits) {
      issues.push({
        id: `address-mismatch-${company.companyNumber}`,
        field: "address",
        severity: "error",
        message: `The registered office for ${company.companyName} does not match Companies House.`,
        correction: `Change it to ${company.address}.`,
        found: extracted.addressHints[0] || extracted.postcodes.join(", ") || "not found",
        expected: company.address,
        fixable: true,
      });
    }
  }

  for (const director of extracted.directors) {
    if (!officerHit(director, officers)) {
      issues.push({
        id: `director-${director}`,
        field: "director",
        severity: "error",
        message: `${director} is named as a director but is not a current officer of any company on this document.`,
        correction: officerSummary
          ? `Replace the director with a current officer: ${officerSummary}.`
          : "Replace the director with a current Companies House officer of a company named on this document.",
        found: director,
        expected: officerSummary,
      });
    }
  }
  for (const signatory of extracted.signatories) {
    if (!officerHit(signatory, officers)) {
      issues.push({
        id: `signatory-${signatory}`,
        field: "signatory",
        severity: "warning",
        message: `${signatory} appears as a signatory but is not a current officer of any company on this document.`,
        correction: officerSummary
          ? `Confirm they are authorised, or name a current officer: ${officerSummary}.`
          : "Confirm they are authorised, or name a current Companies House officer.",
        found: signatory,
      });
    }
  }
  return issues;
}

export async function checkExtractedDocument(
  extracted: ExtractedCompany,
  key: string,
): Promise<CheckResult> {
  const companies: CompanyRecord[] = [];
  const issues: Issue[] = [];
  const seen = new Set<string>();

  const addNumber = async (number: string) => {
    const normalised = number.toUpperCase();
    if (!normalised || seen.has(normalised)) return;
    seen.add(normalised);
    const company = await loadCompany(normalised, key);
    if (company) companies.push(company);
    else {
      issues.push({
        id: `unknown-number-${normalised}`,
        field: "number",
        severity: "error",
        message: `Companies House has no live record for ${normalised}.`,
        correction: "Put the current company number from the Companies House record on the document.",
        found: normalised,
      });
    }
  };

  const orderedNumbers = uniqueNumbers(extracted.numbers).slice(0, 8);
  const loadedRows = await Promise.all(
    orderedNumbers.map(async (number) => {
      seen.add(number);
      return { number, company: await loadCompany(number, key) };
    }),
  );
  for (const row of loadedRows) {
    if (row.company) companies.push(row.company);
    else {
      issues.push({
        id: `unknown-number-${row.number}`,
        field: "number",
        severity: "error",
        message: `Companies House has no live record for ${row.number}.`,
        correction: "Put the current company number from the Companies House record on the document.",
        found: row.number,
      });
    }
  }

  for (const name of extracted.names.slice(0, 8)) {
    if (companies.some((company) => namesOverlap(name, company.companyName))) continue;
    const found = await searchCompany(name, key);
    if (found.kind === "found") {
      await addNumber(found.number);
      continue;
    }
    issues.push({
      id: `unknown-name-${foldCompanyText(name)}`,
      field: "status",
      severity: "error",
      message:
        found.kind === "ambiguous"
          ? `${name} is named on this document but matches more than one Companies House record.`
          : `${name} is named on this document but could not be confirmed as a live Companies House company.`,
      correction:
        found.kind === "ambiguous"
          ? `Add the unique company number from Companies House for ${name}.`
          : `Add the company number from Companies House, or replace ${name} with a live company.`,
      found: name,
    });
  }

  if (!companies.length && !issues.length) {
    return {
      fileId: extracted.fileId,
      fileName: extracted.fileName,
      issues: [
        {
          id: "lookup",
          field: "lookup",
          severity: "error",
          message: "No UK company number or recognisable company name was found to look up.",
          correction: "Add the registered company name and number as they appear on Companies House.",
        },
      ],
      ok: false,
    };
  }

  const compared = [...issues, ...compare(extracted, companies)];
  const blocking = compared.filter((issue) => issue.severity === "error");
  return {
    fileId: extracted.fileId,
    fileName: extracted.fileName,
    company: companies[0],
    companies,
    issues: compared,
    ok: blocking.length === 0,
  };
}

export function companiesHouseConfigured() {
  return Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());
}

export function companiesHouseKey() {
  return process.env.COMPANIES_HOUSE_API_KEY?.trim() || "";
}
