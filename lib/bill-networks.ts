export type NetworkArea = {
  operator: string;
  licenceArea: string;
  distributorIds: number[];
};

const DNO: Record<number, NetworkArea> = {
  10: { operator: "UK Power Networks", licenceArea: "Eastern England", distributorIds: [10] },
  11: {
    operator: "National Grid Electricity Distribution",
    licenceArea: "East Midlands",
    distributorIds: [11],
  },
  12: { operator: "UK Power Networks", licenceArea: "London", distributorIds: [12] },
  13: { operator: "SP Energy Networks", licenceArea: "Merseyside and North Wales", distributorIds: [13] },
  14: {
    operator: "National Grid Electricity Distribution",
    licenceArea: "West Midlands",
    distributorIds: [14],
  },
  15: { operator: "Northern Powergrid", licenceArea: "North East England", distributorIds: [15] },
  16: { operator: "Electricity North West", licenceArea: "North West England", distributorIds: [16] },
  17: {
    operator: "Scottish & Southern Electricity Networks",
    licenceArea: "North of Scotland",
    distributorIds: [17],
  },
  18: { operator: "SP Energy Networks", licenceArea: "Central and southern Scotland", distributorIds: [18] },
  19: { operator: "UK Power Networks", licenceArea: "South East England", distributorIds: [19] },
  20: {
    operator: "Scottish & Southern Electricity Networks",
    licenceArea: "Southern England",
    distributorIds: [20],
  },
  21: {
    operator: "National Grid Electricity Distribution",
    licenceArea: "South Wales",
    distributorIds: [21],
  },
  22: {
    operator: "National Grid Electricity Distribution",
    licenceArea: "South West England",
    distributorIds: [22],
  },
  23: { operator: "Northern Powergrid", licenceArea: "Yorkshire", distributorIds: [23] },
};

const IDNO_FROM = 24;

/** Postcode area (letters) to MPAN distributor IDs. Boundary areas list every plausible DNO. */
const AREA_TO_IDS: Record<string, number[]> = {
  AB: [17],
  AL: [10],
  B: [14],
  BA: [22],
  BB: [16],
  BD: [23],
  BH: [20],
  BL: [16],
  BN: [19],
  BR: [12],
  BS: [22],
  CA: [16],
  CB: [10],
  CF: [21],
  CH: [13],
  CM: [10],
  CO: [10],
  CR: [12, 19],
  CT: [19],
  CV: [14],
  CW: [13],
  DA: [12],
  DD: [18],
  DE: [11],
  DG: [18],
  DH: [15],
  DL: [15],
  DN: [23, 11],
  DT: [22],
  DY: [14],
  E: [12],
  EC: [12],
  EH: [18],
  EN: [10, 12],
  EX: [22],
  FK: [18],
  FY: [16],
  G: [18],
  GL: [22],
  GU: [20],
  HA: [12],
  HD: [23],
  HG: [23],
  HP: [20],
  HR: [14],
  HS: [17],
  HU: [23],
  HX: [23],
  IG: [12],
  IP: [10],
  IV: [17],
  KA: [18],
  KT: [12, 19],
  KW: [17],
  KY: [18],
  L: [13],
  LA: [16],
  LD: [21],
  LE: [11],
  LL: [13],
  LN: [11],
  LS: [23],
  LU: [10],
  M: [16],
  ME: [19],
  MK: [10],
  ML: [18],
  N: [12],
  NE: [15],
  NG: [11],
  NN: [11],
  NP: [21],
  NR: [10],
  NW: [12],
  OL: [16],
  OX: [20],
  PA: [18],
  PE: [11, 10],
  PH: [17],
  PL: [22],
  PO: [20],
  PR: [16],
  RG: [20],
  RH: [19],
  RM: [10],
  S: [23],
  SA: [21],
  SE: [12],
  SG: [10],
  SK: [16],
  SL: [20],
  SM: [12, 19],
  SN: [20],
  SO: [20],
  SP: [20],
  SR: [15],
  SS: [10],
  ST: [14],
  SW: [12],
  SY: [14, 13],
  TA: [22],
  TD: [18],
  TF: [14],
  TN: [19],
  TQ: [22],
  TR: [22],
  TS: [15],
  TW: [12, 20],
  UB: [12],
  W: [12],
  WA: [13],
  WC: [12],
  WD: [10],
  WF: [23],
  WN: [16],
  WR: [14],
  WS: [14],
  WV: [14],
  YO: [23],
  ZE: [17],
};

const SCOTTISH_AREAS = new Set([
  "AB",
  "DD",
  "DG",
  "EH",
  "FK",
  "G",
  "HS",
  "IV",
  "KA",
  "KW",
  "KY",
  "ML",
  "PA",
  "PH",
  "TD",
  "ZE",
]);

const MPAN_PRIMES = [3, 5, 7, 13, 17, 19, 23, 29, 31, 37, 41, 43];

export function postcodeArea(postcode: string) {
  const match = postcode.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{1,2})[0-9]/);
  return match?.[1] || "";
}

export function isScottishPostcode(postcode: string) {
  return SCOTTISH_AREAS.has(postcodeArea(postcode));
}

export function mpanDistributorId(core: string) {
  return Number(core.slice(0, 2));
}

export function isIndependentDistributor(id: number) {
  return id >= IDNO_FROM;
}

export function networkForDistributor(id: number): NetworkArea | null {
  if (DNO[id]) return DNO[id];
  if (id >= IDNO_FROM && id <= 52) {
    return {
      operator: "Independent network operator",
      licenceArea: "Not tied to one DNO region",
      distributorIds: [id],
    };
  }
  return null;
}

export function networksForPostcode(postcode: string): NetworkArea[] {
  const ids = AREA_TO_IDS[postcodeArea(postcode)] || [];
  const seen = new Set<number>();
  const out: NetworkArea[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const network = networkForDistributor(id);
    if (network) out.push(network);
  }
  return out;
}

export function mpanCheckDigit(first12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * MPAN_PRIMES[i];
  }
  return (sum % 11) % 10;
}

export function withMpanCheckDigit(first12: string) {
  return `${first12}${mpanCheckDigit(first12)}`;
}

export function mpanChecksumOk(core: string) {
  if (!/^\d{13}$/.test(core)) return false;
  const id = mpanDistributorId(core);
  if (id < 10 || id > 52) return false;
  return mpanCheckDigit(core.slice(0, 12)) === Number(core[12]);
}

export function dnoIdsForPostcode(postcode: string) {
  return [...new Set((AREA_TO_IDS[postcodeArea(postcode)] || []).filter((id) => id < IDNO_FROM))];
}

export function correctedMpanForAddress(core: string, postcode: string) {
  if (!/^\d{13}$/.test(core)) return null;
  const currentId = mpanDistributorId(core);
  if (currentId < 10 || currentId > 52) return null;
  const ids = dnoIdsForPostcode(postcode);
  if (ids.length === 1 && ids[0] !== currentId && !isIndependentDistributor(currentId)) {
    return {
      core: withMpanCheckDigit(`${String(ids[0]).padStart(2, "0")}${core.slice(2, 12)}`),
      reason: "network" as const,
    };
  }
  if (!mpanChecksumOk(core)) {
    const checksummed = withMpanCheckDigit(core.slice(0, 12));
    const nextId = mpanDistributorId(checksummed);
    if (!ids.length || ids.includes(nextId) || isIndependentDistributor(nextId)) {
      return { core: checksummed, reason: "checksum" as const };
    }
    if (ids.length === 1) {
      return {
        core: withMpanCheckDigit(`${String(ids[0]).padStart(2, "0")}${core.slice(2, 12)}`),
        reason: "network" as const,
      };
    }
  }
  return null;
}

export function formatMpan(core: string) {
  return `${core.slice(0, 2)} ${core.slice(2, 6)} ${core.slice(6, 10)} ${core.slice(10)}`;
}

export function shapeMpanLike(found: string, core: string) {
  const digits = found.replace(/\D/g, "");
  if (digits.length === 13 && !/\s/.test(found)) return core;
  return formatMpan(core);
}
