import { checkExtractedBill } from "@/lib/bill-check";
import type { ExtractedBill } from "@/lib/bill-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return Response.json({ configured: true });
}

export async function POST(request: Request) {
  let body: { documents?: ExtractedBill[] };
  try {
    body = (await request.json()) as { documents?: ExtractedBill[] };
  } catch {
    return Response.json({ error: "Could not read the bill check request." }, { status: 400 });
  }

  const documents = Array.isArray(body.documents) ? body.documents.slice(0, 12) : [];
  if (!documents.length) {
    return Response.json({ error: "No bills to check." }, { status: 400 });
  }

  const results = [];
  for (const document of documents) {
    results.push(
      await checkExtractedBill({
        fileId: document.fileId ? String(document.fileId) : undefined,
        fileName: String(document.fileName || "file"),
        mpans: Array.isArray(document.mpans) ? document.mpans.slice(0, 8) : [],
        mprns: Array.isArray(document.mprns) ? document.mprns.slice(0, 8) : [],
        spids: Array.isArray(document.spids) ? document.spids.slice(0, 8) : [],
        postcodes: Array.isArray(document.postcodes) ? document.postcodes.slice(0, 8) : [],
        addressHints: Array.isArray(document.addressHints)
          ? document.addressHints.slice(0, 8)
          : [],
      }),
    );
  }

  return Response.json({ results });
}
