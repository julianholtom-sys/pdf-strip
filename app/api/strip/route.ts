import { kindFromName, mimeForKind, stripFile } from "@/lib/strip";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_BYTES = 32 * 1024 * 1024;

function asciiFilename(name: string) {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
}

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a file to wipe." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "That file is over 32 MB." },
      { status: 413 },
    );
  }

  const kind = kindFromName(file.name, file.type);
  if (!kind) {
    return Response.json(
      { error: "Use a PDF, JPEG, PNG, or Word (.docx) file." },
      { status: 415 },
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  try {
    const result = await stripFile(kind, input);
    const filename = asciiFilename(file.name);
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": mimeForKind(kind),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Strip-Engine": result.engine,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The file could not be cleaned.";
    return Response.json({ error: message }, { status: 422 });
  }
}
