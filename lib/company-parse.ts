import type { ExtractedCompany } from "./company-types";

const CRN_RE =
  /\b((?:SC|NI|OC|SO|NC|NL|FC|GS|RS|CE|CS|ES|NA|SA|SL|SZ|R0)[0-9]{6}|[0-9]{8})\b/gi;
const LABELLED_CRN_RE =
  /(?:company(?:\s+registration)?(?:\s+no(?:umber)?)?|company\s+number|registered\s+(?:no(?:umber)?|company)|co(?:mpany)?\.?\s*(?:reg(?:istration)?)?\.?\s*no\.?|crn)[:\s#No.]*([A-Z]{0,2}\d{6,8})/gi;
const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?[ ]?[0-9][A-Z]{2})\b/gi;
const PARTY_ROLES =
  "Client|Contractor|Broker|Supplier|Customer|Principal|Buyer|Seller|Provider|Vendor|Consultant|Agency";
const COMPANY_TAIL = "(?:Limited|LIMITED|Ltd\\.?|LTD\\.?|LLP|PLC|Plc|C\\.?I\\.?C\\.?)";
const ACCOUNT_CONTEXT_RE =
  /\b(?:account\s*(?:no(?:umber)?|number|#)|acc(?:ount)?\.?\s*no|sort\s*code|iban|swift|bic|roll\s*number)\b/i;

type PartyHit = {
  name: string;
  role: string;
  index: number;
  number?: string;
  address?: string;
  postcode?: string;
};

function unique(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.replace(/\s+/g, " ").trim();
    if (!key) continue;
    const folded = key.toUpperCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(key);
  }
  return out;
}

function isPlausibleCrn(value: string) {
  const crn = value.toUpperCase();
  if (/^(SC|NI|OC|SO|NC|NL|FC|GS|RS|CE|CS|ES|NA|SA|SL|SZ|R0)\d{6}$/.test(crn)) {
    return true;
  }
  if (!/^\d{8}$/.test(crn)) return false;
  if (/^20[0-3]\d[01]\d[0-3]\d$/.test(crn)) return false;
  return true;
}

function captures(text: string, regex: RegExp, group = 1) {
  const out: string[] = [];
  const copy = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = copy.exec(text))) {
    if (match[group]) out.push(match[group].trim());
  }
  return out;
}

function tidyPerson(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[,;]+$/g, "")
    .replace(/\b(director|signatory|authorised|authorized|signed|mr|mrs|ms|miss|dr)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikePerson(value: string) {
  if (!value || value.length < 4 || value.length > 60) return false;
  if (/\d/.test(value)) return false;
  if (/\b(limited|ltd\.?|llp|plc|llc|cic|company|partnership)\b/i.test(value)) {
    return false;
  }
  const parts = value.split(" ").filter(Boolean);
  return parts.length >= 2 && parts.length <= 4 && parts.every((part) => /^[A-Z][a-zA-Z'.-]+$/.test(part));
}

export function foldCompanyText(value: string) {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\bLIMITED\b/g, "LTD")
    .replace(/\bPUBLIC LIMITED COMPANY\b/g, "PLC")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function foldPostcode(value: string) {
  return value.toUpperCase().replace(/\s+/g, "");
}

function normaliseDoc(text: string) {
  return text
    .replace(/\(\s*formerly\b[^)]*\)/gi, " ")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ");
}

function isAccountContext(text: string, index: number) {
  return ACCOUNT_CONTEXT_RE.test(text.slice(Math.max(0, index - 48), index + 28));
}

function tidyPartyName(value: string) {
  const stripped = value
    .replace(/\s+/g, " ")
    .replace(/,?\s*trading as\b[\s\S]*$/i, "")
    .replace(/["']/g, "")
    .trim();
  const core = stripped.match(
    /((?:24\/7\s+)?(?:\d{2,4}\s+)?[A-Z][A-Za-z0-9&.'’\-]*(?:\s+[A-Z][A-Za-z0-9&.'’\-]*){0,6}\s+(?:Limited|LIMITED|Ltd\.?|LTD\.?|LLP|PLC))$/i,
  );
  return (core?.[1] || stripped).replace(/^[.:;\-–—\s]+/, "").trim();
}

function looksLikePartyName(value: string) {
  if (!value || value.length < 4 || value.length > 80) return false;
  if (/\b(liability|cannot|lawfully|agreement|schedule|hereby|whereas|background|between|clause)\b/i.test(value)) {
    return false;
  }
  if (/^\d+[.,]/.test(value) && !/^(?:24\/7|\d{2,4}\s+[A-Z])/.test(value)) return false;
  return new RegExp(`${COMPANY_TAIL}$`, "i").test(value);
}

function pushParty(out: PartyHit[], name: string, role: string, index: number) {
  const tidy = tidyPartyName(name);
  if (!looksLikePartyName(tidy)) return;
  const folded = foldCompanyText(tidy);
  const existing = out.find((row) => foldCompanyText(row.name) === folded);
  if (existing) {
    if (!existing.role && role) existing.role = role;
    return;
  }
  out.push({ name: tidy, role, index });
}

function extractPartyHits(text: string) {
  const out: PartyHit[] = [];
  const roleNameRe = new RegExp(
    String.raw`(?:Company\s+Name|NAME)\s*[:.]?\s*([^\n()]{3,90}?)\s*\(\s*the\s+"?(${PARTY_ROLES})"?\s*\)`,
    "gi",
  );
  const bareRoleRe = new RegExp(
    String.raw`\b([0-9A-Z][A-Za-z0-9&.'’\-\/]*(?:[\s,]+[A-Za-z0-9&.'’\-\/]+){0,6}\s+${COMPANY_TAIL})\s*\(\s*the\s+"?(${PARTY_ROLES})"?\s*\)`,
    "g",
  );
  const nameLabelRe = new RegExp(
    String.raw`\bNAME\s+([0-9A-Z][A-Z0-9&.'’\-\/, ]{1,80}?${COMPANY_TAIL})\b`,
    "g",
  );
  const invoiceRe = new RegExp(
    String.raw`(?:invoice\s+(?:to|from)|bill\s+to|sold\s+to)\s*[:.\s]+([^\n]{3,80}?${COMPANY_TAIL})`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = roleNameRe.exec(text))) {
    pushParty(out, match[1], match[2], match.index);
  }
  while ((match = bareRoleRe.exec(text))) {
    pushParty(out, match[1], match[2], match.index);
  }
  while ((match = nameLabelRe.exec(text))) {
    pushParty(out, match[1], "", match.index);
  }
  while ((match = invoiceRe.exec(text))) {
    pushParty(out, match[1], "", match.index);
  }

  out.sort((a, b) => a.index - b.index);
  return out.slice(0, 6);
}

function labelledNumbers(text: string) {
  const out: { value: string; index: number }[] = [];
  const copy = new RegExp(LABELLED_CRN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = copy.exec(text))) {
    const value = (match[1] || "").toUpperCase();
    if (!isPlausibleCrn(value) || isAccountContext(text, match.index)) continue;
    out.push({ value, index: match.index });
  }
  return out;
}

function firstWindowCrn(text: string, start: number, taken: Set<string>) {
  const window = text.slice(start, start + 520);
  const labelled = new RegExp(LABELLED_CRN_RE.source, "i").exec(window);
  if (labelled?.[1] && isPlausibleCrn(labelled[1]) && !isAccountContext(text, start + (labelled.index || 0))) {
    const value = labelled[1].toUpperCase();
    if (!taken.has(value)) return value;
  }
  const loose = new RegExp(CRN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = loose.exec(window))) {
    const value = match[1].toUpperCase();
    if (!isPlausibleCrn(value) || taken.has(value)) continue;
    if (isAccountContext(text, start + match.index)) continue;
    return value;
  }
  return "";
}

function assignPartyDetails(text: string, parties: PartyHit[]) {
  if (!parties.length) return parties;
  const numbers = labelledNumbers(text);
  const lastParty = Math.max(...parties.map((party) => party.index));
  const clustered =
    numbers.length > 0 &&
    numbers.every((row) => row.index > lastParty) &&
    numbers.length >= Math.min(2, parties.length);

  if (clustered) {
    parties.forEach((party, index) => {
      if (numbers[index]) party.number = numbers[index].value;
    });
    const offices: { value: string; index: number }[] = [];
    const officeRe =
      /(?:registered\s+office(?:\s+address)?|company\s+address)\s*[:.\s]+(.{8,80}?)(?=\s+(?:REGISTERED OFFICE|CONTACT|COMPANY NUMBER|AND\b)|$)/gi;
    let officeMatch: RegExpExecArray | null;
    while ((officeMatch = officeRe.exec(text))) {
      if (officeMatch.index > lastParty) {
        offices.push({
          value: officeMatch[1].replace(/\s+/g, " ").trim(),
          index: officeMatch.index,
        });
      }
    }
    parties.forEach((party, index) => {
      if (!offices[index]) return;
      party.address = offices[index].value
        .replace(/\s+(?:REGISTERED OFFICE|CONTACT|COMPANY NUMBER|AND).*/i, "")
        .trim();
      const postcode = party.address.match(/\b([A-Z]{1,2}[0-9][0-9A-Z]?[ ]?[0-9][A-Z]{2})\b/i);
      if (postcode) party.postcode = postcode[1].toUpperCase();
    });
  } else {
    for (const row of numbers) {
      let best = -1;
      for (let i = 0; i < parties.length; i += 1) {
        if (parties[i].number) continue;
        if (parties[i].index < row.index && (best < 0 || parties[i].index > parties[best].index)) {
          best = i;
        }
      }
      if (best >= 0) parties[best].number = row.value;
    }
  }

  const taken = new Set(parties.map((party) => party.number).filter(Boolean) as string[]);
  for (const party of parties) {
    if (!party.number) {
      const found = firstWindowCrn(text, party.index, taken);
      if (found) {
        party.number = found;
        taken.add(found);
      }
    }
    if (party.address && party.postcode) continue;
    const window = text.slice(party.index, party.index + 520);
    if (!party.postcode) {
      const postcode = window.match(/\b([A-Z]{1,2}[0-9][0-9A-Z]?[ ]?[0-9][A-Z]{2})\b/i)?.[1];
      if (postcode) party.postcode = postcode.toUpperCase();
    }
    if (!party.address) {
      const address = window.match(
        /(?:registered\s+office(?:\s+address)?|company\s+address)\s*[:.\s]+([^\n]{8,140})/i,
      );
      if (address?.[1]) {
        party.address = address[1]
          .replace(/\s+/g, " ")
          .replace(/\s+(?:AND|Company Number|Guarantor|BACKGROUND|each a|CONTACT|REGISTERED OFFICE).*/i, "")
          .trim();
      }
    }
  }
  return parties;
}

function extractPartyDirectors(text: string) {
  return unique(
    [
      ...captures(text, /(?:^|\n)\s*directors?[:\s]+([^\n]{3,80})/gi),
      ...captures(text, /([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){0,3})\s*[,–-]\s*Directors?\b/g),
      ...captures(text, /Director[:\s]+([A-Z][^\n]{3,60})/g),
      ...captures(
        text,
        new RegExp(
          String.raw`Guarantor Director of the (?:${PARTY_ROLES})[:\s]+([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){1,3})\s+of\b`,
          "g",
        ),
      ),
    ]
      .flatMap((row) => row.split(/[,;/&]|\band\b/i))
      .map(tidyPerson)
      .filter(looksLikePerson),
  );
}

export function extractCompanyFields(text: string, fileName = ""): ExtractedCompany {
  const normalised = normaliseDoc(text);
  const parties = assignPartyDetails(normalised, extractPartyHits(normalised));
  const numbers = unique(parties.map((party) => party.number || "").filter(Boolean));
  const names = unique(parties.map((party) => party.name));
  const postcodes = unique(parties.map((party) => party.postcode || "").filter(Boolean));
  const addressHints = unique(parties.map((party) => party.address || "").filter(Boolean));

  const directors = extractPartyDirectors(normalised).filter((person) =>
    parties.some((party) => {
      const window = normalised.slice(party.index, party.index + 700);
      return window.includes(person);
    }),
  );

  const signatories = unique(
    [
      ...captures(normalised, /signed\s+(?:by|for)\s*[:\s]+([^\n]{3,80})/gi),
      ...captures(normalised, /authorised\s+signator(?:y|ies)[:\s]+([^\n]{3,80})/gi),
      ...captures(normalised, /for and on behalf of[^\n]{0,80}[\n\r]+\s*([A-Z][^\n]{3,60})/gi),
    ]
      .map(tidyPerson)
      .filter(looksLikePerson),
  );

  return {
    fileName,
    numbers,
    names,
    postcodes,
    addressHints,
    directors,
    signatories,
  };
}
