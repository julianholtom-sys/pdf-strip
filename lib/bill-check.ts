import {
  formatMpan,
  isIndependentDistributor,
  isScottishPostcode,
  mpanChecksumOk,
  mpanDistributorId,
  networkForDistributor,
  networksForPostcode,
  postcodeArea,
} from "./bill-networks";
import { foldBillPostcode } from "./bill-parse";
import type { BillCheckResult, BillIssue, ExtractedBill, SupplyRecord } from "./bill-types";

async function lookupPostcode(postcode: string) {
  const compact = foldBillPostcode(postcode);
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(compact)}`,
      { cache: "no-store" },
    );
    if (response.status === 404) return { ok: false as const, status: 404 };
    if (!response.ok) return { ok: false as const, status: response.status };
    const body = (await response.json()) as { result?: { postcode?: string } };
    return { ok: true as const, postcode: body.result?.postcode || postcode };
  } catch {
    return { ok: false as const, status: 0 };
  }
}

function areaNames(postcode: string) {
  return networksForPostcode(postcode)
    .map((row) => `${row.operator} (${row.licenceArea})`)
    .join("; ");
}

export async function checkExtractedBill(extracted: ExtractedBill): Promise<BillCheckResult> {
  const issues: BillIssue[] = [];
  const supplies: SupplyRecord[] = [];
  const postcodes = extracted.postcodes.map((value) => value.toUpperCase());
  let canonical = postcodes[0] || "";

  if (canonical) {
    const looked = await lookupPostcode(canonical);
    if (looked.ok === false && looked.status === 404) {
      issues.push({
        id: "postcode-unknown",
        field: "address",
        severity: "error",
        message: "The postcode on the bill is not a live UK postcode.",
        correction: `Change ${canonical} to the live UK postcode for the supply address.`,
        found: canonical,
      });
    } else if (looked.ok) {
      canonical = looked.postcode;
    }
  }

  const liveMpans = extracted.mpans.filter(mpanChecksumOk);
  for (const raw of extracted.mpans) {
    if (!mpanChecksumOk(raw)) {
      issues.push({
        id: `mpan-invalid-${raw}`,
        field: "identifier",
        severity: "error",
        message: "The electricity supply number (MPAN) on the bill fails its check digit, so it is not a valid meter point.",
        correction: "Replace it with the 13-digit MPAN printed by the supplier, including a valid check digit.",
        found: raw,
      });
    }
  }

  for (const mpan of liveMpans) {
    const id = mpanDistributorId(mpan);
    const network = networkForDistributor(id);
    supplies.push({
      kind: "mpan",
      value: formatMpan(mpan),
      label: "MPAN",
      operator: network?.operator || "Unknown network",
      licenceArea: network?.licenceArea || "",
    });
    if (!canonical) {
      issues.push({
        id: `mpan-no-address-${mpan}`,
        field: "address",
        severity: "error",
        message: "An MPAN is present but no UK postcode was found, so the supply cannot be checked against the bill address.",
        correction: "Add the supply address postcode to the bill.",
        found: formatMpan(mpan),
      });
      continue;
    }
    if (isIndependentDistributor(id)) {
      issues.push({
        id: `mpan-idno-${mpan}`,
        field: "address",
        severity: "warning",
        message: `${formatMpan(mpan)} is on an independent network, which is not tied to one DNO region, so the postcode cannot confirm the site.`,
        correction: "Confirm the MPAN with the supplier against the printed address before wiping.",
        found: canonical,
        expected: network?.operator,
      });
      continue;
    }
    const allowed = networksForPostcode(canonical);
    const allowedIds = allowed.flatMap((row) => row.distributorIds);
    if (!allowed.length) {
      issues.push({
        id: `mpan-area-unknown-${mpan}`,
        field: "address",
        severity: "warning",
        message: `No distribution network mapping is held for postcode area ${postcodeArea(canonical) || canonical}.`,
        correction: "Confirm the MPAN and postcode with the supplier before wiping.",
        found: canonical,
      });
      continue;
    }
    if (!allowedIds.includes(id)) {
      issues.push({
        id: `mpan-mismatch-${mpan}`,
        field: "address",
        severity: "error",
        message:
          "The electricity supply number does not belong to the network that covers the address on the bill.",
        correction: `Use an MPAN for ${areaNames(canonical) || canonical}, or correct the bill address postcode.`,
        found: `${formatMpan(mpan)} · ${network?.operator || "unknown network"} (${network?.licenceArea || "unknown area"})`,
        expected: areaNames(canonical) || canonical,
      });
    }
  }

  for (const mprn of extracted.mprns) {
    supplies.push({
      kind: "mprn",
      value: mprn,
      label: "MPRN",
      operator: "Gas meter point",
      licenceArea: "",
    });
    if (!canonical) {
      issues.push({
        id: `mprn-no-address-${mprn}`,
        field: "address",
        severity: "error",
        message: "A gas MPRN is present but no UK postcode was found on the bill.",
        correction: "Add the supply address postcode to the bill.",
        found: mprn,
      });
    } else if (!/^\d{6,10}$/.test(mprn)) {
      issues.push({
        id: `mprn-invalid-${mprn}`,
        field: "identifier",
        severity: "error",
        message: "The gas meter point reference is not a 6–10 digit MPRN.",
        correction: "Replace it with the 6–10 digit MPRN from the supplier.",
        found: mprn,
      });
    }
  }

  for (const spid of extracted.spids) {
    supplies.push({
      kind: "spid",
      value: spid,
      label: "SPID",
      operator: "Scottish water supply point",
      licenceArea: "Scotland",
    });
    if (!canonical) {
      issues.push({
        id: `spid-no-address-${spid}`,
        field: "address",
        severity: "error",
        message: "A water SPID is present but no UK postcode was found on the bill.",
        correction: "Add the supply address postcode to the bill.",
        found: spid,
      });
    } else if (!isScottishPostcode(canonical)) {
      issues.push({
        id: `spid-mismatch-${spid}`,
        field: "address",
        severity: "error",
        message: "A Scottish water SPID is on the bill, but the address postcode is not in Scotland.",
        correction: `Change the address postcode to a Scottish postcode, or remove the SPID if this is not a Scottish water bill. Found ${canonical}.`,
        found: `${spid} · ${canonical}`,
        expected: "A Scottish postcode",
      });
    }
  }

  if (!extracted.mpans.length && !extracted.mprns.length && !extracted.spids.length) {
    issues.push({
      id: "lookup",
      field: "lookup",
      severity: "error",
      message:
        "No MPAN, MPRN, or SPID was found. Energy bills usually print a supply number (MPAN/S number) or gas MPRN next to the property address.",
      correction: "Add the MPAN, MPRN or SPID from the bill next to the property address.",
    });
  }

  const blocking = issues.filter((issue) => issue.severity === "error");
  return {
    fileId: extracted.fileId,
    fileName: extracted.fileName,
    supplies,
    issues,
    ok: blocking.length === 0,
  };
}
