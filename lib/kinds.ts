export type StripKind = "pdf" | "jpeg" | "png" | "docx";

export function kindFromName(name: string, type: string): StripKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || type === "application/pdf") return "pdf";
  if (lower.endsWith(".png") || type === "image/png") return "png";
  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    type === "image/jpeg"
  ) {
    return "jpeg";
  }
  if (
    lower.endsWith(".docx") ||
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return null;
}

export function mimeForKind(kind: StripKind) {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}

export function filenameForPaste(file: File, index: number) {
  if (file.name && file.name !== "image.png" && file.name !== "blob") {
    return file.name;
  }
  const kind = kindFromName(file.name, file.type);
  const ext =
    kind === "jpeg" ? "jpg" : kind === "png" ? "png" : kind === "pdf" ? "pdf" : "bin";
  return `pasted-${index + 1}.${ext}`;
}
