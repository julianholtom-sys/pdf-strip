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

function badgeFor(status: Status) {
  if (status === "ready") return { className: "badge completed", label: "Clean" };
  if (status === "wiping") return { className: "badge wiping", label: "Wiping" };
  if (status === "error") return { className: "badge error", label: "Failed" };
  return { className: "badge queued", label: "Queued" };
}

function BrandMark() {
  return (
    <svg
      className="brand-logo"
      viewBox="0 0 36 36"
      width={36}
      height={36}
      aria-hidden="true"
    >
      <rect width="36" height="36" rx="8" fill="#0074FF" />
      <path d="M11 9h9.4L25 13.4V27H11Z" fill="#fff" />
      <path
        d="M20.4 9V13.4H25"
        fill="none"
        stroke="#dceaff"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M13.4 17.2h9.2M13.4 20.2h9.2"
        stroke="#0074FF"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M9 24h18" stroke="#0047a3" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
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
    if (!items.length) return "Strip metadata";
    if (busy) return "Wiping files";
    if (readyCount === items.length) return "Clean copies ready";
    return "Strip metadata";
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
                error: error instanceof Error ? error.message : "The wipe failed.",
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
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span className="brand-copy">
            <span className="brand-mark">PDF-Strip</span>
            <span className="brand-sub">Metadata wipe</span>
          </span>
        </div>
        <nav className="nav-links">
          <span className="muted">Unlisted · anyone with the link</span>
        </nav>
      </header>

      <main className="main">
        <section className="hero-panel">
          <h1>{headline}</h1>
          <p>
            Drop a PDF, photo, or Word file. Author names, dates, software stamps,
            EXIF, and Content Credentials are stripped. Colour profiles stay so the
            page still looks like itself.
          </p>
        </section>

        <div className="toolbar">
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Choose files
          </button>
          {readyCount > 1 ? (
            <button type="button" className="btn" onClick={downloadAll}>
              Download all
            </button>
          ) : null}
          {items.length > 0 ? (
            <button type="button" className="btn secondary" onClick={clearAll}>
              Clear
            </button>
          ) : null}
          <span className="muted">PDF, JPEG, PNG, DOCX · 32 MB each · paste several at once</span>
        </div>

        <div className="split">
          <section>
            <label
              onDragEnter={(event) => {
                event.preventDefault();
                setHover(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setHover(false)}
              onDrop={onDrop}
              className={`drop-slot${hover ? " is-hover" : ""}`}
            >
              <input
                ref={inputRef}
                className="file-slot-input"
                type="file"
                accept={ACCEPT}
                multiple
                onChange={(event) => {
                  if (event.target.files?.length) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <strong>Drop or paste files</strong>
              <span>several at once · nothing is stored</span>
            </label>

            {items.length > 0 ? (
              <div className="envelope-list">
                {items.map((item, index) => {
                  const badge = badgeFor(item.status);
                  return (
                    <div
                      key={item.id}
                      className="envelope-row"
                      style={{ animationDelay: `${Math.min(index, 8) * 0.04}s` }}
                    >
                      <div>
                        <h3>{item.file.name}</h3>
                        <div className="meta">
                          {kindLabel(item.file.name)} · {formatSize(item.file.size)}
                          {item.engine ? ` · ${item.engine}` : ""}
                          {item.status === "error" ? ` · ${item.error}` : ""}
                        </div>
                        {item.status === "wiping" ? <span className="wipe-bar" /> : null}
                      </div>
                      <div className="envelope-row-actions">
                        <span className={badge.className}>{badge.label}</span>
                        {item.status === "ready" && item.url ? (
                          <a className="btn" href={item.url} download={item.file.name}>
                            Download
                          </a>
                        ) : null}
                        {item.status === "error" ? (
                          <button type="button" className="btn secondary" onClick={() => void wipeOne(item)}>
                            Retry
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          <aside className="panel">
            <h2>What it removes</h2>
            <ul>
              <li>Author, creator, dates, and software stamps</li>
              <li>EXIF on photos, plus JPEG comments</li>
              <li>Content Credentials and C2PA attachments</li>
              <li>Word document properties and custom tags</li>
            </ul>
            <p className="muted" style={{ margin: "0.9rem 0 0" }}>
              Files are wiped in memory, then discarded. The download keeps the
              original filename, ready to put back.
            </p>
          </aside>
        </div>

        <footer className="page-foot">
          <p className="muted">
            Share this page: <span style={{ color: "var(--ink)", wordBreak: "break-all" }}>{share || "this link"}</span>
          </p>
          <p className="muted">
            Do not upload files you are not allowed to handle. The wipe removes hidden
            tags; it does not redact what is printed on the page.
          </p>
        </footer>
      </main>
    </div>
  );
}
