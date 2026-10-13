import {
  checkExtractedDocument,
  companiesHouseConfigured,
  companiesHouseKey,
} from "@/lib/company-house";
import type { ExtractedCompany } from "@/lib/company-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return Response.json({ configured: companiesHouseConfigured() });
}

export async function POST(request: Request) {
  if (!companiesHouseConfigured()) {
    return Response.json(
      {
        error:
          "Companies House is not connected. Add COMPANIES_HOUSE_API_KEY on the host, then try again.",
      },
      { status: 503 },
    );
  }

  let body: { documents?: ExtractedCompany[] };
  try {
    body = (await request.json()) as { documents?: ExtractedCompany[] };
  } catch {
    return Response.json({ error: "Could not read the check request." }, { status: 400 });
  }

  const documents = Array.isArray(body.documents) ? body.documents.slice(0, 12) : [];
  if (!documents.length) {
    return Response.json({ error: "No documents to check." }, { status: 400 });
  }

  const key = companiesHouseKey();
  const results = [];
  for (const document of documents) {
    results.push(
      await checkExtractedDocument(
        {
          fileId: document.fileId ? String(document.fileId) : undefined,
          fileName: String(document.fileName || "file"),
          numbers: Array.isArray(document.numbers) ? document.numbers.slice(0, 8) : [],
          names: Array.isArray(document.names) ? document.names.slice(0, 8) : [],
          postcodes: Array.isArray(document.postcodes) ? document.postcodes.slice(0, 8) : [],
          addressHints: Array.isArray(document.addressHints)
            ? document.addressHints.slice(0, 8)
            : [],
          directors: Array.isArray(document.directors) ? document.directors.slice(0, 12) : [],
          signatories: Array.isArray(document.signatories)
            ? document.signatories.slice(0, 12)
            : [],
        },
        key,
      ),
    );
  }

  return Response.json({ results });
}
