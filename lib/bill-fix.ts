import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import type { BillCheckResult } from "./bill-types";
import type { TextRun } from "./company-types";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function collectFixes(result: BillCheckResult) {
  return result.issues.filter((issue) => issue.fixable && issue.expected);
}

function digits(value: string) {
  return value.replace(/\D+/g, "");
}

function pickFont(name = "") {
  const n = name.toLowerCase();
  const bold = /bold|black|heavy/.test(n);
  if (/courier|mono|consolas|menlo/.test(n)) {
    return bold ? StandardFonts.CourierBold : StandardFonts.Courier;
  }
  if ((/times|georgia|garamond|cambria/.test(n) || /serif/.test(n)) && !/sans/.test(n)) {
    return bold ? StandardFonts.TimesRomanBold : StandardFonts.TimesRoman;
  }
  return bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
}

function findDigitSpan(runs: TextRun[], needle: string) {
  const target = digits(needle);
  if (target.length < 6) return null;
  for (let start = 0; start < runs.length; start += 1) {
    let collected = "";
    const span: TextRun[] = [];
    for (let end = start; end < Math.min(runs.length, start + 48); end += 1) {
      if (runs[end].pageIndex !== runs[start].pageIndex) break;
      const part = digits(runs[end].str);
      if (part) {
        if (part.includes(target)) return [runs[end]];
        span.push(runs[end]);
        collected += part;
        if (collected === target) return span;
        if (!target.startsWith(collected)) break;
      } else if (span.length && /[A-Za-z]/.test(runs[end].str)) {
        break;
      }
    }
  }
  return null;
}

async function fixPdf(bytes: Uint8Array, result: BillCheckResult, runs: TextRun[]) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const pages = pdf.getPages();
  let applied = 0;
  for (const issue of collectFixes(result)) {
    if (!issue.expected || !issue.found) continue;
    const span = findDigitSpan(runs, issue.found);
    if (!span?.length) continue;
    const page = pages[span[0].pageIndex];
    if (!page) continue;
    const font = await pdf.embedFont(pickFont(span[0].fontName));
    const minX = Math.min(...span.map((run) => run.x));
    const minY = Math.min(...span.map((run) => run.y));
    const maxX = Math.max(...span.map((run) => run.x + Math.max(run.width, 6)));
    const maxY = Math.max(...span.map((run) => run.y + Math.max(run.height, 8)));
    const size = Math.max(7, Math.min(12, span[0].height || 9));
    page.drawRectangle({
      x: minX - 1,
      y: minY - 1,
      width: Math.max(maxX - minX + 2, font.widthOfTextAtSize(issue.expected, size) + 4),
      height: Math.max(maxY - minY + 2, size + 3),
      color: rgb(1, 1, 1),
    });
    page.drawText(issue.expected, {
      x: minX,
      y: minY,
      size,
      font,
      color: rgb(0.06, 0.09, 0.16),
    });
    applied += 1;
  }
  return { bytes: await pdf.save({ useObjectStreams: false }), applied };
}

async function fixDocx(bytes: Uint8Array, result: BillCheckResult) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((name) =>
    /^(word\/document\.xml|word\/header\d+\.xml|word\/footer\d+\.xml)$/i.test(name),
  );
  let applied = 0;
  for (const name of files) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async("string");
    for (const issue of collectFixes(result)) {
      if (!issue.expected || !issue.found) continue;
      if (xml.includes(issue.found)) {
        xml = xml.split(issue.found).join(escapeXml(issue.expected));
        applied += 1;
        continue;
      }
      const compact = digits(issue.found);
      if (compact.length >= 8 && xml.replace(/\D+/g, "").includes(compact)) {
        xml = xml.replace(issue.found, escapeXml(issue.expected));
        applied += 1;
      }
    }
    zip.file(name, xml);
  }
  return {
    bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
    applied,
  };
}

export async function applyBillFixes(
  kind: "pdf" | "docx",
  bytes: Uint8Array,
  result: BillCheckResult,
  runs: TextRun[],
) {
  const fixes = collectFixes(result);
  if (!fixes.length) return { bytes, applied: 0 };
  if (kind === "pdf") return await fixPdf(bytes, result, runs);
  return await fixDocx(bytes, result);
}

