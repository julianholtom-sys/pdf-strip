"use client";

import { filenameForPaste, kindFromName, mimeForKind } from "@/lib/kinds";
import { stripInBrowser } from "@/lib/strip-fallback";
import { useEffect, useMemo, useRef, useState } from "react";

type Status = "queued" | "wiping" | "ready" | "error";

type Item = {
  id: string;
  file: File;
  status: Status;
  error?: string;
  url?: string;
  engine?: string;
};

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "PDF";
  if (ext === "docx") return "Word";
  if (ext === "png") return "PNG";
  if (ext === "jpg" || ext === "jpeg") return "Photo";
  return ext.toUpperCase();
}

function filesFromClipboard(data: DataTransfer | null) {
  if (!data) return [] as File[];
  const listed = Array.from(data.files ?? []);
  if (listed.length) return listed;
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return fromItems;
}

function normalizeFiles(list: FileList | File[]) {
  return Array.from(list)
    .map((file, index) => {
      const kind = kindFromName(file.name, file.type);
      if (!kind) return null;
      const name = filenameForPaste(file, index);
      if (name === file.name) return file;
      return new File([file], name, { type: file.type, lastModified: file.lastModified });
    })
    .filter((file): file is File => Boolean(file));
}

export function StripApp() {
  const inputRef = useRef<HTMLInputElement>(null);
  const addFilesRef = useRef<(list: FileList | File[]) => void>(() => {});
  const [items, setItems] = useState<Item[]>([]);
  const [hover, setHover] = useState(false);
  const [share, setShare] = useState("");

  useEffect(() => {
    setShare(window.location.href);
  }, []);

  const readyCount = items.filter((item) => item.status === "ready").length;
  const busy = items.some((item) => item.status === "wiping");

  const headline = useMemo(() => {
    if (!items.length) return "Drop the file. It comes back without a past.";
    if (busy) return "Wiping fingerprints from the file.";
    if (readyCount === items.length) return "Clean. Same name. Yours to take.";
    return "Leave nothing on the page but the page.";
  }, [busy, items.length, readyCount]);

  async function wipeClient(file: File) {
    const kind = kindFromName(file.name, file.type);
    if (!kind) throw new Error("Use a PDF, JPEG, PNG, or Word (.docx) file.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cleaned = await stripInBrowser(kind, bytes);
    const copy = new Uint8Array(cleaned);
    return {
      url: URL.createObjectURL(new Blob([copy], { type: mimeForKind(kind) })),
      engine: "rewrite",
    };
  }

  async function wipeOne(item: Item) {
    setItems((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, status: "wiping", error: undefined } : row,
      ),
    );
    try {
      let url: string | undefined;
      let engine = "rewrite";
      const body = new FormData();
      body.append("file", item.file);
      try {
        const response = await fetch("/api/strip", { method: "POST", body });
        if (response.ok) {
          const blob = await response.blob();
          url = URL.createObjectURL(blob);
          engine = response.headers.get("X-Strip-Engine") ?? "native";
        }
      } catch {
        /* GitHub Pages has no API; wipe in the browser instead. */
      }
      if (!url) {
        const local = await wipeClient(item.file);
        url = local.url;
        engine = local.engine;
      }
      setItems((current) =>
        current.map((row) => {
          if (row.id !== item.id) return row;
          if (row.url) URL.revokeObjectURL(row.url);
          return { ...row, status: "ready", url, engine };
        }),
      );
    } catch (error) {
      setItems((current) =>
        current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: "error",
                error:
                  error instanceof Error ? error.message : "The wipe failed.",
              }
            : row,
        ),
      );
    }
  }

  function addFiles(list: FileList | File[]) {
    const allowed = normalizeFiles(list);
    if (!allowed.length) return;
    const next: Item[] = allowed.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      status: "queued",
    }));
    setItems((current) => [...current, ...next]);
    for (const item of next) void wipeOne(item);
  }

  addFilesRef.current = addFiles;

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const files = filesFromClipboard(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      addFilesRef.current(files);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setHover(false);
    if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
  }

  function clearAll() {
    for (const item of items) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    setItems([]);
  }

  function downloadAll() {
    for (const item of items) {
      if (!item.url) continue;
      const link = document.createElement("a");
      link.href = item.url;
      link.download = item.file.name;
      link.click();
    }
  }

  return (
    <div className="crop crop-bottom min-h-dvh px-5 py-8 sm:px-10 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-5xl flex-col">
        <header className="flex flex-col gap-3 border-b border-rule pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <p className="font-serif text-sm tracking-[0.28em] whitespace-nowrap text-wax uppercase">
            PDF-Strip
          </p>
          <p className="max-w-sm text-xs leading-5 text-muted sm:text-right">
            Unlisted on purpose. Anyone with this link can use it.
          </p>
        </header>

        <main className="flex flex-1 flex-col gap-10 py-10 lg:flex-row lg:items-start lg:gap-16">
          <section className="lg:w-[42%]">
            <p className="text-[11px] tracking-[0.22em] text-muted uppercase">
              Metadata · EXIF · C2PA
            </p>
            <h1 className="mt-4 font-serif text-4xl leading-[1.12] text-ink sm:text-5xl">
              {headline}
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-muted">
              PDFs, photos, and Word files. Author names, dates, software
              stamps, EXIF, and Content Credentials are stripped. Colour
              profiles stay so the page still looks like itself.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-ink">
              <li className="flex gap-3">
                <span className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full bg-wax" />
                Files are wiped in memory, then discarded. Nothing is kept.
              </li>
              <li className="flex gap-3">
                <span className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full bg-wax" />
                The download uses the original filename, ready to put back.
              </li>
              <li className="flex gap-3">
                <span className="mt-2 block h-1.5 w-1.5 shrink-0 rounded-full bg-wax" />
                Same engine as the desktop tool: ExifTool, then a full rewrite.
              </li>
            </ul>
          </section>

          <section className="flex-1">
            <label
              onDragEnter={(event) => {
                event.preventDefault();
                setHover(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setHover(false)}
              onDrop={onDrop}
              className={`block cursor-pointer rounded-[2px] border border-dashed px-6 py-14 text-center transition-colors ${
                hover
                  ? "border-wax bg-wax/10"
                  : "border-rule bg-ticket/70 hover:border-wax/70"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files?.length) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <p className="font-serif text-2xl text-ink">Drop or paste files</p>
              <p className="mt-2 text-sm text-muted">
                several at once · PDF, JPEG, PNG, DOCX · 32 MB each
              </p>
            </label>

            {items.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between gap-3 text-xs tracking-[0.16em] text-muted uppercase">
                  <span>
                    {readyCount}/{items.length} clean
                  </span>
                  <span className="flex gap-4">
                    {readyCount > 1 && (
                      <button
                        type="button"
                        onClick={downloadAll}
                        className="text-wax hover:text-wax-deep"
                      >
                        Download all
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={clearAll}
                      className="hover:text-ink"
                    >
                      Clear
                    </button>
                  </span>
                </div>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-4 border border-rule bg-ticket px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{item.file.name}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {kindLabel(item.file.name)} · {formatSize(item.file.size)}
                          {item.engine ? ` · ${item.engine}` : ""}
                          {item.status === "wiping" ? " · wiping" : ""}
                          {item.status === "error" ? ` · ${item.error}` : ""}
                        </p>
                        {item.status === "wiping" && (
                          <span className="wipe-bar mt-2 block h-px bg-wax" />
                        )}
                      </div>
                      {item.status === "ready" && item.url && (
                        <a
                          href={item.url}
                          download={item.file.name}
                          className="shrink-0 bg-ink px-3 py-2 text-xs tracking-[0.14em] text-paper uppercase hover:bg-wax"
                        >
                          Download
                        </a>
                      )}
                      {item.status === "error" && (
                        <button
                          type="button"
                          onClick={() => void wipeOne(item)}
                          className="shrink-0 border border-wax px-3 py-2 text-xs tracking-[0.14em] text-wax uppercase"
                        >
                          Retry
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </main>

        <footer className="mt-auto border-t border-rule pt-5 text-xs leading-5 text-muted">
          <p>
            Share this page:{" "}
            <span className="break-all text-ink">{share || "this link"}</span>
          </p>
          <p className="mt-1">
            Do not upload files you are not allowed to handle. The wipe removes
            hidden tags; it does not redact what is printed on the page.
          </p>
        </footer>
      </div>
    </div>
  );
}
