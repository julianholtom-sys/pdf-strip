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
  registered_office_address?: ChAddress;
};

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
  return {
    companyNumber: (profile.data.company_number || number).toUpperCase(),
    companyName: profile.data.company_name || "",
    companyStatus: profile.data.company_status || "",
    address: address.text,
    addressLines: address.lines,
    postalCode: address.postalCode,
    officers,
  };
}

async function searchCompany(name: string, key: string): Promise<string | null> {
  const result = await chGet<{ items?: { company_number?: string; title?: string }[] }>(
    `/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`,
    key,
  );
  if (!result.ok || !result.data.items?.length) return null;
  const folded = foldCompanyText(name);
  const exact = result.data.items.find((row) => foldCompanyText(row.title || "") === folded);
  if (exact?.company_number) return exact.company_number;
  if (result.data.items.length === 1 && result.data.items[0].company_number) {
    return result.data.items[0].company_number;
  }
  return result.data.items[0]?.company_number || null;
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
    if (company.companyStatus && company.companyStatus !== "active") {
      issues.push({
        id: `status-${company.companyNumber}`,
        field: "status",
        severity: "error",
        message: `Companies House lists ${company.companyName} as ${company.companyStatus}.`,
        found: company.companyStatus,
        expected: "active",
      });
    }
  }

  if (extracted.names.length) {
    for (const name of extracted.names) {
      const hit = companies.some((company) => namesOverlap(name, company.companyName));
      if (!hit) {
        issues.push({
          id: `name-mismatch-${name}`,
          field: "name",
          severity: "warning",
          message: "A company name on the document does not clearly match Companies House.",
          found: name,
          expected: companies.map((company) => company.companyName).join("; "),
        });
      }
    }
  }

  const docPostcodes = extracted.postcodes.map(foldPostcode);
  const addressBlob = foldCompanyText(
    [...extracted.addressHints, ...extracted.postcodes, extracted.fileName].join(" "),
  );
  for (const company of companies) {
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
        message: `Registered office for ${company.companyName} does not match Companies House.`,
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
        message: `${signatory} appears as a signatory but is not a current officer of any company on this document. Confirm they are authorised before wiping.`,
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
  const numbers = uniqueNumbers(extracted.numbers).slice(0, 4);
  if (!numbers.length) {
    for (const name of extracted.names.slice(0, 4)) {
      const found = await searchCompany(name, key);
      if (found) numbers.push(found.toUpperCase());
    }
  }
  if (!numbers.length) {
    return {
      fileId: extracted.fileId,
      fileName: extracted.fileName,
      issues: [
        {
          id: "lookup",
          field: "lookup",
          severity: "error",
          message: "No UK company number or recognisable company name was found to look up.",
        },
      ],
      ok: false,
    };
  }

  const companies: CompanyRecord[] = [];
  const issues: Issue[] = [];
  for (const number of uniqueNumbers(numbers)) {
    const company = await loadCompany(number, key);
    if (company) companies.push(company);
    else {
      issues.push({
        id: `unknown-number-${number}`,
        field: "number",
        severity: "error",
        message: `Companies House has no live record for ${number}.`,
        found: number,
      });
    }
  }
  if (!companies.length) {
    return { fileId: extracted.fileId, fileName: extracted.fileName, issues, ok: false };
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
