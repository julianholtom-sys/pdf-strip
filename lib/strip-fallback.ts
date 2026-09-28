import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32(bytes: Uint8Array, i: number) {
  return (
    ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>>
    0
  );
}

export async function stripPdfRewrite(
  bytes: Uint8Array,
  onProgress?: (pct: number) => void,
) {
  onProgress?.(20);
  const src = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  onProgress?.(45);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const page of pages) out.addPage(page);
  out.setTitle("");
  out.setAuthor("");
  out.setSubject("");
  out.setKeywords([]);
  out.setProducer("");
  out.setCreator("");
  onProgress?.(75);
  const saved = await out.save({ useObjectStreams: true });
  onProgress?.(95);
  return saved;
}

export function stripJpegExif(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Not a JPEG");
  }
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      chunks.push(bytes.subarray(i));
      break;
    }
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;
    const marker = bytes[i];
    i += 1;
    if (marker === 0xda) {
      chunks.push(Uint8Array.of(0xff, marker), bytes.subarray(i));
      break;
    }
    if (marker === 0xd9) {
      chunks.push(Uint8Array.of(0xff, marker));
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      chunks.push(Uint8Array.of(0xff, marker));
      continue;
    }
    if (i + 1 >= bytes.length) break;
    const length = (bytes[i] << 8) | bytes[i + 1];
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) {
      chunks.push(Uint8Array.of(0xff, marker), bytes.subarray(i, i + length));
    }
    i += length;
  }
  return concat(chunks);
}

export function stripPngText(bytes: Uint8Array) {
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  if (bytes.length < 8 || sig.some((value, i) => bytes[i] !== value)) {
    throw new Error("Not a PNG");
  }
  const drop = new Set(["tEXt", "zTXt", "iTXt", "tIME", "eXIf"]);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = u32(bytes, i);
    const type = String.fromCharCode(
      bytes[i + 4],
      bytes[i + 5],
      bytes[i + 6],
      bytes[i + 7],
    );
    const chunk = bytes.subarray(i, i + 12 + length);
    if (!drop.has(type)) parts.push(chunk);
    i += 12 + length;
    if (type === "IEND") break;
  }
  return concat(parts);
}

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"></cp:coreProperties>`;

export async function stripDocx(
  bytes: Uint8Array,
  onProgress?: (pct: number) => void,
) {
  onProgress?.(20);
  const zip = await JSZip.loadAsync(bytes);
  onProgress?.(40);
  zip.file("docProps/core.xml", EMPTY_CORE);
  zip.remove("docProps/custom.xml");

  const relsFile = zip.file("_rels/.rels");
  if (relsFile) {
    let rels = await relsFile.async("string");
    rels = rels.replace(/<Relationship[^>]*custom-properties[^>]*\/>/g, "");
    zip.file("_rels/.rels", rels);
  }

  const typesFile = zip.file("[Content_Types].xml");
  if (typesFile) {
    let types = await typesFile.async("string");
    types = types.replace(
      /<Override[^>]*\/docProps\/custom\.xml"[^>]*\/>/g,
      "",
    );
    zip.file("[Content_Types].xml", types);
  }

  const app = zip.file("docProps/app.xml");
  if (app) {
    let xml = await app.async("string");
    xml = xml
      .replace(/<Company>[\s\S]*?<\/Company>/g, "")
      .replace(/<Manager>[\s\S]*?<\/Manager>/g, "")
      .replace(/<TotalTime>[\s\S]*?<\/TotalTime>/g, "")
      .replace(/<Template>[\s\S]*?<\/Template>/g, "")
      .replace(/<Application>[\s\S]*?<\/Application>/g, "")
      .replace(/<AppVersion>[\s\S]*?<\/AppVersion>/g, "");
    zip.file("docProps/app.xml", xml);
  }

  const media = Object.keys(zip.files).filter((name) =>
    /^word\/media\/.+\.jpe?g$/i.test(name),
  );
  for (const name of media) {
    const file = zip.file(name);
    if (!file) continue;
    const image = new Uint8Array(await file.async("uint8array"));
    zip.file(name, stripJpegExif(image));
  }

  onProgress?.(80);
  const packed = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  onProgress?.(95);
  return packed;
}

export async function stripInBrowser(
  kind: "pdf" | "jpeg" | "png" | "docx",
  bytes: Uint8Array,
  onProgress?: (pct: number) => void,
) {
  if (kind === "pdf") return await stripPdfRewrite(bytes, onProgress);
  onProgress?.(30);
  if (kind === "jpeg") {
    const out = stripJpegExif(bytes);
    onProgress?.(95);
    return out;
  }
  if (kind === "png") {
    const out = stripPngText(bytes);
    onProgress?.(95);
    return out;
  }
  return await stripDocx(bytes, onProgress);
}
