import type { ExtractedCompany } from "./company-types";

const CRN_RE =
  /\b((?:SC|NI|OC|SO|NC|NL|FC|GS|RS|CE|CS|ES|NA|SA|SL|SZ|R0)[0-9]{6}|[0-9]{8})\b/gi;
const LABELLED_CRN_RE =
  /(?:company(?:\s+registration)?(?:\s+no(?:umber)?)?|registered\s+(?:no(?:umber)?|company)|co(?:mpany)?\.?\s*(?:reg(?:istration)?)?\.?\s*no\.?|crn)[:\s#No.]*([A-Z]{0,2}\d{6,8})/gi;
const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?[ ]?[0-9][A-Z]{2})\b/gi;
const NAME_RE =
  /\b([A-Z][A-Za-z0-9&.'’\-]{1,40}(?:\s+[A-Z][A-Za-z0-9&.'’\-]{1,40}){0,6}\s+(?:Limited|Ltd\.?|LLP|PLC|Plc|C\.?I\.?C\.?))\b/g;

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
  const parts = value.split(" ").filter(Boolean);
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[A-Z][a-zA-Z'.-]+$/.test(part));
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

export function extractCompanyFields(text: string, fileName = ""): ExtractedCompany {
  const labelled = captures(text, LABELLED_CRN_RE).filter(isPlausibleCrn);
  const loose = captures(text, CRN_RE, 1).filter(isPlausibleCrn);
  const numbers = unique([...labelled, ...loose].map((value) => value.toUpperCase()));
  const names = unique(captures(text, NAME_RE, 1));
  const postcodes = unique(captures(text, POSTCODE_RE, 1).map((value) => value.toUpperCase()));

  const directors = unique(
    [
      ...captures(text, /(?:^|\n)\s*directors?[:\s]+([^\n]{3,80})/gi),
      ...captures(text, /([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){0,3})\s*[,–-]\s*Directors?\b/g),
      ...captures(text, /Director[:\s]+([A-Z][^\n]{3,60})/g),
    ]
      .flatMap((row) => row.split(/[,;/&]|\band\b/i))
      .map(tidyPerson)
      .filter(looksLikePerson),
  );

  const signatories = unique(
    [
      ...captures(text, /signed\s+(?:by|for)\s*[:\s]+([^\n]{3,80})/gi),
      ...captures(text, /authorised\s+signator(?:y|ies)[:\s]+([^\n]{3,80})/gi),
      ...captures(text, /for and on behalf of[^\n]{0,80}[\n\r]+\s*([A-Z][^\n]{3,60})/gi),
    ]
      .map(tidyPerson)
      .filter(looksLikePerson),
  );

  const addressHints = unique(
    captures(
      text,
      /(?:registered(?:\s+office)?(?:\s+address)?|reg(?:istered)?\.?\s*office)[:\s]+([^\n]{8,140})/gi,
    ),
  );

  if (fileName) {
    const fromFile = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ");
    const maybe = fromFile.match(NAME_RE);
    if (maybe?.[1]) names.push(maybe[1]);
  }

  return {
    fileName,
    numbers,
    names: unique(names),
    postcodes,
    addressHints,
    directors,
    signatories,
  };
}
