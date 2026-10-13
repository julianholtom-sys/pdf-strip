import { foldPostcode } from "./company-parse";
import type { ExtractedBill } from "./bill-types";
import { mpanChecksumOk } from "./bill-networks";

const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?[ ]?[0-9][A-Z]{2})\b/gi;
const MPAN_LABEL_RE =
  /(?:mpan|supply\s*number|s[\s-]*number|electricity\s*supply(?:\s*number)?|meter\s*point\s*admin(?:istration)?\s*number)[:\s#S]*([0-9][0-9\s]{12,36})/gi;
const MPRN_LABEL_RE =
  /(?:mprn|m[\s-]*number|meter\s*point\s*reference(?:\s*number)?|gas\s*supply(?:\s*number)?)[:\s#M]*([0-9]{6,10})/gi;
const SPID_LABEL_RE = /(?:spid|supply\s*point\s*id)[:\s#]*([0-9]{8,12})/gi;
const ADDRESS_LABEL_RE =
  /(?:supply\s*address|property\s*address|site\s*address|service\s*address|premises(?:\s*address)?)[:\s]+([^\n]{8,160})/gi;

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

function captures(text: string, regex: RegExp, group = 1) {
  const out: string[] = [];
  const copy = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = copy.exec(text))) {
    if (match[group]) out.push(match[group].trim());
  }
  return out;
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

function looksLikeMpanCore(core: string) {
  if (!/^\d{13}$/.test(core)) return false;
  const id = Number(core.slice(0, 2));
  return id >= 10 && id <= 52;
}

function mpansFromDigits(raw: string) {
  const digits = digitsOnly(raw);
  const found: string[] = [];
  if (digits.length >= 21 && looksLikeMpanCore(digits.slice(-13))) {
    found.push(digits.slice(-13));
  }
  if (digits.length >= 13) {
    for (let i = 0; i <= digits.length - 13; i += 1) {
      const core = digits.slice(i, i + 13);
      if (looksLikeMpanCore(core)) found.push(core);
    }
  }
  const list = unique(found);
  const valid = list.filter(mpanChecksumOk);
  return valid.length ? valid : list.slice(0, 4);
}

function scanUnlabelledMpans(text: string) {
  const compact = digitsOnly(text);
  if (compact.length < 13) return [];
  const hits: string[] = [];
  for (let i = 0; i <= compact.length - 13; i += 1) {
    const core = compact.slice(i, i + 13);
    if (mpanChecksumOk(core)) hits.push(core);
  }
  return unique(hits).slice(0, 8);
}

export function extractBillFields(text: string, fileName = ""): ExtractedBill {
  const labelledMpans = captures(text, MPAN_LABEL_RE).flatMap(mpansFromDigits);
  const mpans = unique([...labelledMpans, ...(labelledMpans.length ? [] : scanUnlabelledMpans(text))]);
  const mprns = unique(captures(text, MPRN_LABEL_RE));
  const spids = unique(captures(text, SPID_LABEL_RE));
  const postcodes = unique(captures(text, POSTCODE_RE, 1).map((value) => value.toUpperCase()));
  const addressHints = unique(captures(text, ADDRESS_LABEL_RE));
  return {
    fileName,
    mpans,
    mprns,
    spids,
    postcodes,
    addressHints,
  };
}

export function foldBillPostcode(value: string) {
  return foldPostcode(value);
}
