import JSZip from "jszip";
import type { StripKind } from "./kinds";
import type { TextRun } from "./company-types";

export type ExtractedDoc = {
  kind: StripKind;
  text: string;
  runs: TextRun[];
};

function xmlToText(xml: string) {
  return xml
    .replace(/<w:tab\b[^/]*\/>/g, " ")
    .replace(/<w:br\b[^/]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDoc> {
  const zip = await JSZip.loadAsync(bytes);
  const parts: string[] = [];
  const names = Object.keys(zip.files).filter((name) =>
    /^(word\/document\.xml|word\/header\d+\.xml|word\/footer\d+\.xml)$/i.test(name),
  );
  for (const name of names) {
    const file = zip.file(name);
    if (!file) continue;
    parts.push(xmlToText(await file.async("string")));
  }
  return { kind: "docx", text: parts.join("\n"), runs: [] };
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const data = bytes.slice();
  const loading = pdfjs.getDocument({ data, disableRange: true });
  const doc = await loading.promise;
  const runs: TextRun[] = [];
  const pages: string[] = [];
  try {
    for (let pageIndex = 0; pageIndex < doc.numPages; pageIndex += 1) {
      const page = await doc.getPage(pageIndex + 1);
      const content = await page.getTextContent();
      const line: string[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const transform = item.transform as number[];
        runs.push({
          str: item.str,
          pageIndex,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          width: item.width || 0,
          height: item.height || Math.abs(transform[3] || 10),
        });
        line.push(item.str);
        if (item.hasEOL) line.push("\n");
        else line.push(" ");
      }
      pages.push(line.join(""));
    }
  } finally {
    await loading.destroy();
  }
  return { kind: "pdf", text: pages.join("\n"), runs };
}

export async function extractDocument(kind: StripKind, bytes: Uint8Array): Promise<ExtractedDoc> {
  if (kind === "pdf") return extractPdf(bytes);
  if (kind === "docx") return extractDocx(bytes);
  return { kind, text: "", runs: [] };
}
