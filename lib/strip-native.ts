import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exiftoolPath, qpdfPath, runCommand } from "./tools";

function qpdfOk(code: number) {
  return code === 0 || code === 3;
}

async function listAttachments(pdf: string) {
  const result = await runCommand(qpdfPath(), [
    "--warning-exit-0",
    "--list-attachments",
    "--",
    pdf,
  ]);
  const names: string[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(.+?)\s+->\s+/);
    if (match) names.push(match[1].trim());
  }
  return names;
}

function isC2pa(name: string) {
  return /content\s*credentials|^c2pa$|c2pa/i.test(name);
}

export async function stripPdfNative(bytes: Buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-strip-"));
  const input = path.join(dir, "in.pdf");
  const mid = path.join(dir, "mid.pdf");
  const out = path.join(dir, "out.pdf");
  try {
    await fs.writeFile(input, bytes);
    let current = input;
    const attachments = await listAttachments(current);
    for (const name of attachments) {
      if (!isC2pa(name)) continue;
      const next = path.join(dir, "att.pdf");
      const removed = await runCommand(qpdfPath(), [
        "--warning-exit-0",
        `--remove-attachment=${name}`,
        "--",
        current,
        next,
      ]);
      if (!qpdfOk(removed.code)) {
        throw new Error(removed.stderr || "qpdf could not remove Content Credentials");
      }
      current = next;
    }

    const exif = await runCommand(exiftoolPath(), [
      "-overwrite_original",
      "-all:all=",
      "--",
      current,
    ]);
    if (exif.code > 1) {
      throw new Error(exif.stderr || "ExifTool could not clear tags");
    }

    const linearized = await runCommand(qpdfPath(), [
      "--warning-exit-0",
      "--linearize",
      "--object-streams=generate",
      "--compress-streams=y",
      "--recompress-flate",
      "--",
      current,
      out,
    ]);
    if (!qpdfOk(linearized.code)) {
      throw new Error(linearized.stderr || "qpdf could not rewrite the file");
    }
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function stripImageNative(bytes: Buffer, ext: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-strip-img-"));
  const file = path.join(dir, `in${ext}`);
  try {
    await fs.writeFile(file, bytes);
    const exif = await runCommand(exiftoolPath(), [
      "-overwrite_original",
      "-all:all=",
      "--icc_profile:all",
      "--",
      file,
    ]);
    if (exif.code > 1) {
      throw new Error(exif.stderr || "ExifTool could not clear image tags");
    }
    return await fs.readFile(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
