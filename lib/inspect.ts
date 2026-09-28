import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import type { StripKind } from "./kinds";

export type Finding = {
  id: string;
  label: string;
};

function add(list: Finding[], id: string, label: string) {
  if (!list.some((row) => row.id === id)) list.push({ id, label });
}

function latin1(bytes: Uint8Array, start = 0, end = bytes.length) {
  const slice = bytes.subarray(start, Math.min(end, bytes.length));
  const limit = Math.min(slice.length, 2_000_000);
  let out = "";
  for (let i = 0; i < limit; i += 1) out += String.fromCharCode(slice[i]);
  return out;
}

function hasText(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function hasDatePattern(text: string) {
  return (
    /\d{4}[:\-]\d{2}[:\-]\d{2}/.test(text) ||
    /D:\d{4}/.test(text) ||
    /20\d{2}:\d{2}:\d{2}/.test(text)
  );
}

function u32(bytes: Uint8Array, i: number) {
  return (
    ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>>
    0
  );
}

function inspectJpeg(bytes: Uint8Array) {
  const findings: Finding[] = [];
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return findings;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;
    const marker = bytes[i];
    i += 1;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 1 >= bytes.length) break;
    const length = (bytes[i] << 8) | bytes[i + 1];
    const payload = bytes.subarray(i + 2, i + length);
    const text = latin1(payload);
    if (marker === 0xe1 && text.startsWith("Exif")) {
      add(findings, "exif", "EXIF");
      if (hasDatePattern(text)) add(findings, "exif-date", "EXIF date");
      if (hasText(text, "GPS")) add(findings, "gps", "GPS");
      if (hasText(text, "Make") || hasText(text, "Model")) add(findings, "camera", "Camera");
      if (hasText(text, "Software")) add(findings, "software", "Software");
    }
    if (marker === 0xe1 && hasText(text, "http://ns.adobe.com/xap")) {
      add(findings, "xmp", "XMP");
      if (hasDatePattern(text)) add(findings, "xmp-date", "XMP date");
    }
    if (marker === 0xed) add(findings, "iptc", "IPTC");
    if (marker === 0xfe && payload.length) add(findings, "comment", "Comment");
    i += length;
  }
  return findings;
}

function inspectPng(bytes: Uint8Array) {
  const findings: Finding[] = [];
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  if (bytes.length < 8 || sig.some((value, i) => bytes[i] !== value)) return findings;
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = u32(bytes, i);
    const type = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7],
    );
    const data = bytes.subarray(i + 8, i + 8 + length);
    const text = latin1(data);
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      add(findings, "text", "Text metadata");
      if (hasDatePattern(text)) add(findings, "meta-date", "Metadata date");
    }
    if (type === "tIME") add(findings, "created", "Timestamp");
    if (type === "eXIf") {
      add(findings, "exif", "EXIF");
      if (hasDatePattern(text)) add(findings, "exif-date", "EXIF date");
      if (hasText(text, "GPS")) add(findings, "gps", "GPS");
    }
    i += 12 + length;
    if (type === "IEND") break;
  }
  return findings;
}

function sampleText(bytes: Uint8Array) {
  const head = Math.min(bytes.length, 1_000_000);
  let text = latin1(bytes, 0, head);
  if (bytes.length > head) text += latin1(bytes, Math.max(head, bytes.length - 500_000));
  return text;
}

async function inspectPdf(bytes: Uint8Array) {
  const findings: Finding[] = [];
  const raw = sampleText(bytes);
  if (hasText(raw, "c2pa") || hasText(raw, "Content Credentials")) {
    add(findings, "c2pa", "Content Credentials");
  }
  if (hasText(raw, "<?xpacket") || hasText(raw, "adobe:ns:meta")) {
    add(findings, "xmp", "XMP");
  }
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const title = pdf.getTitle();
    const author = pdf.getAuthor();
    const subject = pdf.getSubject();
    const creator = pdf.getCreator();
    const producer = pdf.getProducer();
    const created = pdf.getCreationDate();
    const modified = pdf.getModificationDate();
    const keywords = pdf.getKeywords();
    if (author) add(findings, "author", "Author");
    if (title) add(findings, "title", "Title");
    if (subject) add(findings, "subject", "Subject");
    if (creator || producer) add(findings, "software", "Software");
    if (created) add(findings, "created", "Created");
    if (modified) add(findings, "modified", "Modified");
    if (keywords && keywords.length) add(findings, "keywords", "Keywords");
  } catch {
    /* fall through to raw markers */
  }
  if (hasText(raw, "/Author")) add(findings, "author", "Author");
  if (hasText(raw, "/CreationDate") || hasText(raw, "xmp:CreateDate")) {
    add(findings, "created", "Created");
  }
  if (hasText(raw, "/ModDate") || hasText(raw, "xmp:ModifyDate")) {
    add(findings, "modified", "Modified");
  }
  if (hasText(raw, "/Producer") || hasText(raw, "/Creator")) {
    add(findings, "software", "Software");
  }
  return findings;
}

function xmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() || "";
}

async function inspectDocx(bytes: Uint8Array) {
  const findings: Finding[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const core = zip.file("docProps/core.xml");
  if (core) {
    const xml = await core.async("string");
    if (xmlTag(xml, "dc:creator") || xmlTag(xml, "cp:lastModifiedBy")) {
      add(findings, "author", "Author");
    }
    if (xmlTag(xml, "dcterms:created")) add(findings, "created", "Created");
    if (xmlTag(xml, "dcterms:modified")) add(findings, "modified", "Modified");
    if (xmlTag(xml, "dc:title")) add(findings, "title", "Title");
  }
  const app = zip.file("docProps/app.xml");
  if (app) {
    const xml = await app.async("string");
    if (xmlTag(xml, "Company")) add(findings, "company", "Company");
    if (xmlTag(xml, "Application") || xmlTag(xml, "AppVersion")) {
      add(findings, "software", "Software");
    }
  }
  if (zip.file("docProps/custom.xml")) add(findings, "custom", "Custom properties");
  const media = Object.keys(zip.files).filter((name) =>
    /^word\/media\/.+\.jpe?g$/i.test(name),
  );
  for (const name of media) {
    const file = zip.file(name);
    if (!file) continue;
    const image = new Uint8Array(await file.async("uint8array"));
    for (const finding of inspectJpeg(image)) {
      if (finding.id === "exif" || finding.id === "exif-date" || finding.id === "gps") {
        add(findings, finding.id, finding.id === "gps" ? "Photo GPS" : "Photo EXIF");
      }
    }
  }
  return findings;
}

export async function inspectBytes(kind: StripKind, bytes: Uint8Array) {
  if (kind === "jpeg") return inspectJpeg(bytes);
  if (kind === "png") return inspectPng(bytes);
  if (kind === "pdf") return inspectPdf(bytes);
  return inspectDocx(bytes);
}
