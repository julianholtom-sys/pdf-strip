import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import type { CheckResult, TextRun } from "./company-types";
import { foldCompanyText, foldPostcode } from "./company-parse";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function collectFixes(result: CheckResult) {
  return result.issues.filter((issue) => issue.fixable && issue.expected);
}

function findRunSpan(runs: TextRun[], needle: string) {
  const foldedNeedle = foldCompanyText(needle);
  if (!foldedNeedle) return null;
  const joined = runs.map((run) => run.str).join(" ");
  if (!foldCompanyText(joined).includes(foldedNeedle) && !joined.toUpperCase().includes(needle.toUpperCase())) {
    return null;
  }
  for (let start = 0; start < runs.length; start += 1) {
    let text = "";
    for (let end = start; end < Math.min(runs.length, start + 24); end += 1) {
      if (runs[end].pageIndex !== runs[start].pageIndex) break;
      text += `${runs[end].str} `;
      const folded = foldCompanyText(text);
      if (folded.includes(foldedNeedle) || foldPostcode(text) === foldPostcode(needle)) {
        return runs.slice(start, end + 1);
      }
    }
  }
  return null;
}

async function fixPdf(bytes: Uint8Array, result: CheckResult, runs: TextRun[]) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  for (const issue of collectFixes(result)) {
    if (!issue.expected) continue;
    const span = issue.found && issue.found !== "not found" ? findRunSpan(runs, issue.found) : null;
    const page = pages[span?.[0]?.pageIndex ?? 0];
    if (!page) continue;
    if (span?.length) {
      const minX = Math.min(...span.map((run) => run.x));
      const minY = Math.min(...span.map((run) => run.y));
      const maxX = Math.max(...span.map((run) => run.x + Math.max(run.width, 8)));
      const maxY = Math.max(...span.map((run) => run.y + Math.max(run.height, 8)));
      const size = Math.max(7, Math.min(11, span[0].height || 9));
      page.drawRectangle({
        x: minX - 1,
        y: minY - 1,
        width: Math.max(maxX - minX + 2, font.widthOfTextAtSize(issue.expected, size) + 4),
        height: Math.max(maxY - minY + 2, size + 3),
        color: rgb(1, 1, 1),
      });
      const lines = issue.expected.split(", ").reduce<string[]>((acc, part) => {
        const last = acc[acc.length - 1];
        const next = last ? `${last}, ${part}` : part;
        if (font.widthOfTextAtSize(next, size) < page.getWidth() - minX - 36) {
          if (!acc.length) acc.push(part);
          else acc[acc.length - 1] = next;
        } else {
          acc.push(part);
        }
        return acc;
      }, []);
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: minX,
          y: minY - index * (size + 2),
          size,
          font,
          color: rgb(0.06, 0.09, 0.16),
        });
      });
    } else {
      const size = 8;
      page.drawRectangle({
        x: 36,
        y: 28,
        width: page.getWidth() - 72,
        height: 22,
        color: rgb(1, 1, 1),
      });
      page.drawText(`${issue.field === "number" ? "Company no." : "Registered office"}: ${issue.expected}`, {
        x: 40,
        y: 34,
        size,
        font,
        color: rgb(0.06, 0.09, 0.16),
      });
    }
  }
  return await pdf.save({ useObjectStreams: false });
}

async function fixDocx(bytes: Uint8Array, result: CheckResult) {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).filter((name) =>
    /^(word\/document\.xml|word\/header\d+\.xml|word\/footer\d+\.xml)$/i.test(name),
  );
  for (const name of files) {
    const file = zip.file(name);
    if (!file) continue;
    let xml = await file.async("string");
    for (const issue of collectFixes(result)) {
      if (!issue.expected) continue;
      if (issue.found && issue.found !== "not found" && xml.includes(issue.found)) {
        xml = xml.split(issue.found).join(escapeXml(issue.expected));
      }
    }
    zip.file(name, xml);
  }
  const core = zip.file("word/document.xml");
  if (core) {
    let xml = await core.async("string");
    const extras = collectFixes(result).filter(
      (issue) => issue.expected && (!issue.found || issue.found === "not found" || !xml.includes(issue.expected)),
    );
    if (extras.length) {
      const lines = extras
        .map((issue) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(
          issue.field === "number"
            ? `Company no. ${issue.expected}`
            : `Registered office: ${issue.expected}`,
        )}</w:t></w:r></w:p>`)
        .join("");
      xml = xml.replace(/<w:body[^>]*>/, (open) => `${open}${lines}`);
      zip.file("word/document.xml", xml);
    }
  }
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function applyCompanyFixes(
  kind: "pdf" | "docx",
  bytes: Uint8Array,
  result: CheckResult,
  runs: TextRun[],
) {
  if (!collectFixes(result).length) return bytes;
  if (kind === "pdf") return await fixPdf(bytes, result, runs);
  return await fixDocx(bytes, result);
}
