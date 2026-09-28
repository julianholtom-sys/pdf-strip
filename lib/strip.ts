import type { StripKind } from "./kinds";
import { stripDocx, stripJpegExif, stripPdfRewrite, stripPngText } from "./strip-fallback";
import { stripImageNative, stripPdfNative } from "./strip-native";
import { nativeToolsAvailable } from "./tools";

export type { StripKind } from "./kinds";
export { kindFromName, mimeForKind } from "./kinds";

export async function stripFile(kind: StripKind, bytes: Buffer) {
  const native = nativeToolsAvailable();
  if (kind === "pdf") {
    if (native) {
      try {
        return { bytes: await stripPdfNative(bytes), engine: "native" as const };
      } catch {
        return {
          bytes: Buffer.from(await stripPdfRewrite(bytes)),
          engine: "rewrite" as const,
        };
      }
    }
    return {
      bytes: Buffer.from(await stripPdfRewrite(bytes)),
      engine: "rewrite" as const,
    };
  }
  if (kind === "jpeg") {
    if (native) {
      try {
        return {
          bytes: await stripImageNative(bytes, ".jpg"),
          engine: "native" as const,
        };
      } catch {
        return {
          bytes: Buffer.from(stripJpegExif(bytes)),
          engine: "rewrite" as const,
        };
      }
    }
    return {
      bytes: Buffer.from(stripJpegExif(bytes)),
      engine: "rewrite" as const,
    };
  }
  if (kind === "png") {
    if (native) {
      try {
        return {
          bytes: await stripImageNative(bytes, ".png"),
          engine: "native" as const,
        };
      } catch {
        return {
          bytes: Buffer.from(stripPngText(bytes)),
          engine: "rewrite" as const,
        };
      }
    }
    return {
      bytes: Buffer.from(stripPngText(bytes)),
      engine: "rewrite" as const,
    };
  }
  return {
    bytes: Buffer.from(await stripDocx(bytes)),
    engine: "rewrite" as const,
  };
}
