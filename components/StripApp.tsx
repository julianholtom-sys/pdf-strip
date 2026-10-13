"use client";

import { CompanyCheckModal } from "@/components/CompanyCheckModal";
import { applyCompanyFixes } from "@/lib/company-fix";
import { extractCompanyFields } from "@/lib/company-parse";
import type { CheckResult, TextRun } from "@/lib/company-types";
import { extractDocument } from "@/lib/extract-document";
import { inspectBytes, type Finding } from "@/lib/inspect";
import { filenameForPaste, kindFromName, mimeForKind } from "@/lib/kinds";
import { stripInBrowser } from "@/lib/strip-fallback";
import JSZip from "jszip";
import { useEffect, useMemo, useRef, useState } from "react";

type Status = "queued" | "wiping" | "ready" | "error";

type Item = {
  id: string;
  file: File;
  status: Status;
  step: string;
  progress: number;
  findings?: Finding[];
  error?: string;
  url?: string;
  engine?: string;
  companyCheck?: CheckResult;
  wipeBlocked?: boolean;
  needsCompanyCheck?: boolean;
};

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.docx,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const WIPE_MS = 2000;

let nativeApi: boolean | null = null;

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

function isCompanyDoc(item: Item) {
  const kind = kindFromName(item.file.name, item.file.type);
  return kind === "pdf" || kind === "docx";
}

function isWipeable(item: Item) {
  if (item.status !== "queued") return false;
  if (!item.needsCompanyCheck) return true;
  return Boolean(item.companyCheck?.ok) && !item.wipeBlocked;
}

function badgeFor(item: Item) {
  if (item.wipeBlocked && item.needsCompanyCheck) {
    return { className: "badge blocked", label: "Blocked" };
  }
  if (item.status === "ready") return { className: "badge completed", label: "Clean" };
  if (item.status === "wiping") return { className: "badge wiping", label: "Wiping" };
  if (item.status === "error") return { className: "badge error", label: "Failed" };
  if (item.needsCompanyCheck && item.companyCheck?.ok) {
    return { className: "badge completed", label: "Checked" };
  }
  if (item.needsCompanyCheck) return { className: "badge wiping", label: "CH" };
  return { className: "badge queued", label: "Ready" };
}

function stepFor(pct: number) {
  if (pct < 20) return "Reading file";
  if (pct < 50) return "Stripping tags";
  if (pct < 78) return "Rewriting file";
  if (pct < 100) return "Packing the clean file";
  return "Clean";
}

function nativeApiAllowed() {
  if (typeof window === "undefined") return false;
  return !window.location.hostname.endsWith("github.io");
}

function Tick() {
  return (
    <svg className="finding-tick" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3.2 8.2 6.4 11.3 12.8 4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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
  const itemsRef = useRef<Item[]>([]);
  const runningRef = useRef(false);
  const [items, setItems] = useState<Item[]>([]);
  const [hover, setHover] = useState(false);
  const [share, setShare] = useState("");
  const [running, setRunning] = useState(false);
  const [packing, setPacking] = useState(false);
  const [cursor, setCursor] = useState({ i: 0, n: 0 });
  const [toast, setToast] = useState<"off" | "saving" | "saved">("off");
  const [checking, setChecking] = useState(false);
  const [applyingFixes, setApplyingFixes] = useState(false);
  const [modalResults, setModalResults] = useState<CheckResult[] | null>(null);
  const extractRef = useRef(new Map<string, { kind: "pdf" | "docx"; bytes: Uint8Array; runs: TextRun[] }>());

  useEffect(() => {
    setShare(window.location.href);
  }, []);

  itemsRef.current = items;

  const readyCount = items.filter((item) => item.status === "ready").length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const wipingItem = items.find((item) => item.status === "wiping");

  useEffect(() => {
    if (running) {
      setToast("saving");
      return;
    }
    if (items.length > 0 && readyCount === items.length) {
      setToast("saved");
      const timer = window.setTimeout(() => setToast("off"), 2500);
      return () => window.clearTimeout(timer);
    }
    setToast("off");
  }, [running, readyCount, items.length]);

  const headline = useMemo(() => {
    if (!items.length) return "Strip metadata";
    if (running && cursor.n > 0) return `Wiping ${cursor.i} of ${cursor.n}`;
    if (running) return "Wiping files";
    if (queuedCount > 0) return queuedCount === 1 ? "1 file ready" : `${queuedCount} files ready`;
    if (readyCount === items.length) return "Clean copies ready";
    return "Strip metadata";
  }, [items.length, running, cursor, queuedCount, readyCount]);

  function patchItem(id: string, partial: Partial<Item>) {
    setItems((current) => {
      const next = current.map((row) => (row.id === id ? { ...row, ...partial } : row));
      itemsRef.current = next;
      return next;
    });
  }

  function animateProgress(id: string, cancelled: { current: boolean }) {
    const started = performance.now();
    return new Promise<void>((resolve) => {
      const tick = (now: number) => {
        if (cancelled.current) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - started) / WIPE_MS);
        const eased = 1 - (1 - t) ** 3;
        const progress = Math.round(eased * 100);
        patchItem(id, { progress, step: stepFor(progress) });
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async function tryNativeStrip(file: File) {
    if (!nativeApiAllowed() || nativeApi === false) return null;
    const body = new FormData();
    body.append("file", file);
    try {
      const response = await fetch("/api/strip", { method: "POST", body });
      if (!response.ok) {
        nativeApi = false;
        return null;
      }
      nativeApi = true;
      const blob = await response.blob();
      return {
        url: URL.createObjectURL(blob),
        engine: response.headers.get("X-Strip-Engine") ?? "native",
      };
    } catch {
      nativeApi = false;
      return null;
    }
  }

  async function wipeWork(file: File) {
    const kind = kindFromName(file.name, file.type);
    if (!kind) throw new Error("Use a PDF, JPEG, PNG, or Word (.docx) file.");
    const native = await tryNativeStrip(file);
    if (native) return native;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cleaned = await stripInBrowser(kind, bytes);
    const copy = new Uint8Array(cleaned);
    return {
      url: URL.createObjectURL(new Blob([copy], { type: mimeForKind(kind) })),
      engine: "rewrite",
    };
  }

  async function wipeOne(item: Item) {
    const cancelled = { current: false };
    patchItem(item.id, {
      status: "wiping",
      progress: 0,
      step: "Reading file",
      error: undefined,
    });
    try {
      const work = wipeWork(item.file);
      const bar = animateProgress(item.id, cancelled);
      const result = await work;
      await bar;
      setItems((current) =>
        current.map((row) => {
          if (row.id !== item.id) return row;
          if (row.url) URL.revokeObjectURL(row.url);
          return {
            ...row,
            status: "ready",
            progress: 100,
            step: "Clean",
            url: result.url,
            engine: result.engine,
          };
        }),
      );
    } catch (error) {
      cancelled.current = true;
      patchItem(item.id, {
        status: "error",
        progress: 0,
        step: "Failed",
        error: error instanceof Error ? error.message : "The wipe failed.",
      });
    }
  }

  async function startWipe(ids?: string[]) {
    if (runningRef.current) return;
    const blocked = itemsRef.current.filter(
      (item) =>
        item.status === "queued" &&
        item.needsCompanyCheck &&
        item.wipeBlocked &&
        (!ids || ids.includes(item.id)),
    );
    const batch = itemsRef.current.filter((item) => {
      if (!isWipeable(item)) return false;
      if (ids) return ids.includes(item.id);
      return true;
    });
    if (!batch.length) {
      if (blocked.length) {
        setModalResults(blocked.map((item) => item.companyCheck).filter(Boolean) as CheckResult[]);
      }
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setCursor({ i: 0, n: batch.length });
    try {
      for (let i = 0; i < batch.length; i += 1) {
        setCursor({ i: i + 1, n: batch.length });
        await wipeOne(batch[i]);
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
      setCursor({ i: 0, n: 0 });
    }
  }

  async function startCompanyCheck() {
    if (runningRef.current || checking) return;
    const batch = itemsRef.current.filter(
      (item) => item.status === "queued" && item.needsCompanyCheck,
    );
    if (!batch.length) return;
    setChecking(true);
    try {
      const payload: ReturnType<typeof extractCompanyFields>[] = [];
      const skipped: CheckResult[] = [];
      for (const item of batch) {
        const kind = kindFromName(item.file.name, item.file.type);
        if (kind !== "pdf" && kind !== "docx") {
          skipped.push({
            fileId: item.id,
            fileName: item.file.name,
            skipped: "This file type is not checked against Companies House.",
            issues: [],
            ok: true,
          });
          continue;
        }
        const bytes = new Uint8Array(await item.file.arrayBuffer());
        const extracted = await extractDocument(kind, bytes);
        extractRef.current.set(item.id, { kind, bytes, runs: extracted.runs });
        payload.push({
          ...extractCompanyFields(extracted.text, item.file.name),
          fileId: item.id,
        });
      }
      let checked: CheckResult[] = [...skipped];
      if (payload.length) {
        const response = await fetch("/api/companies-house", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documents: payload }),
        });
        const data = (await response.json()) as { results?: CheckResult[]; error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Companies House check failed.");
        }
        checked = [...(data.results ?? []), ...skipped];
      }
      const byId = new Map(
        checked.map((row) => [row.fileId || row.fileName, row] as const),
      );
      const nextItems = itemsRef.current.map((item) => {
        const report = byId.get(item.id) || byId.get(item.file.name);
        if (!report || item.status !== "queued" || !item.needsCompanyCheck) return item;
        const blocked = report.issues.some((issue) => issue.severity === "error");
        return {
          ...item,
          companyCheck: report,
          wipeBlocked: blocked,
          step: blocked ? "Companies House mismatch" : "Checked · ready to wipe",
        };
      });
      itemsRef.current = nextItems;
      setItems(nextItems);
      const checkedIds = batch.map((item) => item.id);
      const needsModal = checked.some((row) => row.issues.length > 0);
      if (needsModal) {
        setModalResults(checked);
        return;
      }
      await startWipe(checkedIds);
    } catch (error) {
      setModalResults([
        {
          fileName: "Companies House",
          ok: false,
          issues: [
            {
              id: "lookup",
              field: "lookup",
              severity: "error",
              message: error instanceof Error ? error.message : "The check failed.",
            },
          ],
        },
      ]);
    } finally {
      setChecking(false);
    }
  }

  async function applyCheckAndWipe() {
    if (runningRef.current) return;
    const reports = modalResults;
    if (!reports) return;
    setApplyingFixes(true);
    try {
      const byId = new Map(
        reports.map((row) => [row.fileId || row.fileName, row] as const),
      );
      for (const item of itemsRef.current) {
        if (item.status !== "queued" || !item.needsCompanyCheck) continue;
        const report = byId.get(item.id) || byId.get(item.file.name) || item.companyCheck;
        if (!report) continue;
        const errors = report.issues.filter((issue) => issue.severity === "error");
        const unfixable = errors.some((issue) => !issue.fixable);
        if (unfixable) continue;
        const extracted = extractRef.current.get(item.id);
        let file = item.file;
        if (errors.some((issue) => issue.fixable) && extracted) {
          const fixed = await applyCompanyFixes(
            extracted.kind,
            extracted.bytes,
            report,
            extracted.runs,
          );
          file = new File([new Uint8Array(fixed)], item.file.name, { type: item.file.type });
          extractRef.current.set(item.id, {
            ...extracted,
            bytes: new Uint8Array(fixed),
          });
        }
        patchItem(item.id, {
          file,
          wipeBlocked: false,
          companyCheck: { ...report, issues: report.issues.filter((issue) => !issue.fixable), ok: true },
          step: "Checked · ready to wipe",
        });
      }
      const passedIds = itemsRef.current
        .filter((item) => item.needsCompanyCheck && item.status === "queued" && !item.wipeBlocked)
        .map((item) => item.id);
      setModalResults(null);
      await startWipe(passedIds);
    } catch (error) {
      setModalResults([
        {
          fileName: "Companies House",
          ok: false,
          issues: [
            {
              id: "lookup",
              field: "lookup",
              severity: "error",
              message: error instanceof Error ? error.message : "The details could not be applied.",
            },
          ],
        },
      ]);
    } finally {
      setApplyingFixes(false);
    }
  }

  function addFiles(list: FileList | File[]) {
    if (runningRef.current) return;
    const allowed = normalizeFiles(list);
    if (!allowed.length) return;
    const next: Item[] = allowed.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      status: "queued",
      step: "Ready to wipe",
      progress: 0,
      needsCompanyCheck: false,
    }));
    setItems((current) => [...current, ...next]);
    for (const item of next) void readFindings(item);
  }

  async function readFindings(item: Item) {
    try {
      const kind = kindFromName(item.file.name, item.file.type);
      if (!kind) {
        patchItem(item.id, { findings: [] });
        return;
      }
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const findings = await inspectBytes(kind, bytes);
      patchItem(item.id, { findings });
    } catch {
      patchItem(item.id, { findings: [] });
    }
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
    if (runningRef.current) return;
    for (const item of items) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    extractRef.current.clear();
    setModalResults(null);
    setItems([]);
  }

  async function downloadAll() {
    const ready = items.filter((item) => item.status === "ready" && item.url);
    if (!ready.length) return;
    setPacking(true);
    try {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const item of ready) {
        const response = await fetch(item.url!);
        const buffer = await response.arrayBuffer();
        let name = item.file.name || "file";
        if (used.has(name)) {
          const split = name.lastIndexOf(".");
          const base = split === -1 ? name : name.slice(0, split);
          const ext = split === -1 ? "" : name.slice(split);
          let n = 2;
          while (used.has(`${base}-${n}${ext}`)) n += 1;
          name = `${base}-${n}${ext}`;
        }
        used.add(name);
        zip.file(name, buffer);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "pdf-strip-clean.zip";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 2000);
    } finally {
      setPacking(false);
    }
  }

  function retry(item: Item) {
    if (item.url) URL.revokeObjectURL(item.url);
    patchItem(item.id, {
      status: "queued",
      step: "Ready to wipe",
      progress: 0,
      error: undefined,
      url: undefined,
      engine: undefined,
      wipeBlocked: false,
      companyCheck: undefined,
    });
  }

  function toggleCompanyCheck(item: Item) {
    if (runningRef.current || item.status !== "queued" || !isCompanyDoc(item)) return;
    const on = !item.needsCompanyCheck;
    patchItem(item.id, {
      needsCompanyCheck: on,
      wipeBlocked: false,
      companyCheck: undefined,
      step: on ? "Companies House required" : "Ready to wipe",
    });
  }

  const toastLabel =
    toast === "saving"
      ? wipingItem
        ? `Wiping ${cursor.i} of ${cursor.n} · ${wipingItem.file.name} · ${wipingItem.progress}%`
        : "Wiping files"
      : toast === "saved"
        ? `${readyCount} clean file${readyCount === 1 ? "" : "s"} ready`
        : "";

  const wipeableCount = items.filter(isWipeable).length;
  const companyCheckCount = items.filter(
    (item) => item.status === "queued" && item.needsCompanyCheck,
  ).length;
  const wipeLabel =
    wipeableCount === 1 ? "Wipe file" : `Wipe ${wipeableCount} files`;

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
        </section>

        <div className="toolbar">
          {wipeableCount > 0 && !running ? (
            <button type="button" className="btn" onClick={() => void startWipe()}>
              {wipeLabel}
            </button>
          ) : null}
          {companyCheckCount > 0 && !running ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => void startCompanyCheck()}
              disabled={checking || applyingFixes}
            >
              {checking
                ? "Checking Companies House…"
                : companyCheckCount === 1
                  ? "Check Companies House"
                  : `Check Companies House (${companyCheckCount})`}
            </button>
          ) : null}
          {running ? (
            <button type="button" className="btn" disabled>
              Wiping…
            </button>
          ) : null}
          <button
            type="button"
            className={queuedCount > 0 || running ? "btn secondary" : "btn"}
            onClick={() => inputRef.current?.click()}
            disabled={running}
          >
            Choose files
          </button>
          {items.length > 1 ? (
            <button
              type="button"
              className="btn"
              onClick={() => void downloadAll()}
              disabled={readyCount === 0 || packing || running}
            >
              {packing
                ? "Packing…"
                : readyCount > 1
                  ? `Download all (${readyCount})`
                  : "Download all"}
            </button>
          ) : null}
          {items.length > 0 ? (
            <button type="button" className="btn secondary" onClick={clearAll} disabled={running}>
              Clear
            </button>
          ) : null}
          <span className="muted">
            PDF, JPEG, PNG, DOCX · 32 MB each · paste several at once
            {items.length > 0 ? ` · ${readyCount}/${items.length} clean` : ""}
          </span>
        </div>

        <div className="split">
          <section>
            <label
              onDragEnter={(event) => {
                event.preventDefault();
                if (!running) setHover(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setHover(false)}
              onDrop={onDrop}
              className={`drop-slot${hover ? " is-hover" : ""}${running ? " is-locked" : ""}`}
            >
              <input
                ref={inputRef}
                className="file-slot-input"
                type="file"
                accept={ACCEPT}
                multiple
                disabled={running}
                onChange={(event) => {
                  if (event.target.files?.length) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <strong>{running ? "Wiping in order" : "Drop or paste files"}</strong>
              <span>
                {running
                  ? "this batch is locked until every file is done"
                  : "add them all, then wipe. Turn on Companies House only for invoices or contracts"}
              </span>
            </label>

            {items.length > 0 ? (
              <div className="envelope-list" aria-live="polite">
                {items.map((item, index) => {
                  const badge = badgeFor(item);
                  return (
                    <div
                      key={item.id}
                      className={`envelope-row${item.status === "wiping" ? " is-wiping" : ""}`}
                      style={{ animationDelay: `${Math.min(index, 8) * 0.04}s` }}
                    >
                      <div className="envelope-row-main">
                        <h3>{item.file.name}</h3>
                        <div className="meta">
                          {kindLabel(item.file.name)} · {formatSize(item.file.size)}
                          {item.status === "wiping" ? ` · ${item.step} · ${item.progress}%` : ""}
                          {item.status === "queued" && item.needsCompanyCheck && item.wipeBlocked
                            ? " · wipe blocked until company details match"
                            : item.status === "queued" && item.needsCompanyCheck && !item.companyCheck
                              ? " · Companies House required before wipe"
                              : item.status === "queued"
                                ? " · waiting in order"
                                : ""}
                          {item.engine && item.status === "ready" ? ` · ${item.engine}` : ""}
                          {item.status === "error" ? ` · ${item.error}` : ""}
                        </div>
                        {(item.status === "queued" || item.status === "wiping") && (
                          <div
                            className="file-progress"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={item.progress}
                            aria-label={`${item.file.name} ${item.step}`}
                          >
                            <span style={{ width: `${item.progress}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="envelope-row-actions">
                        {item.status === "queued" && isCompanyDoc(item) ? (
                          <label
                            className={`ch-toggle${item.needsCompanyCheck ? " is-on" : ""}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(item.needsCompanyCheck)}
                              disabled={running || checking}
                              onChange={() => toggleCompanyCheck(item)}
                            />
                            Companies House
                          </label>
                        ) : null}
                        <span className={badge.className}>{badge.label}</span>
                        {item.status === "ready" && item.url ? (
                          <a className="btn" href={item.url} download={item.file.name}>
                            Download
                          </a>
                        ) : null}
                        {item.status === "error" ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => retry(item)}
                            disabled={running}
                          >
                            Retry
                          </button>
                        ) : null}
                      </div>
                      <ul className="finding-list">
                        {item.findings === undefined ? (
                          <li className="finding-chip">Checking tags…</li>
                        ) : item.findings.length === 0 ? (
                          <li className={`finding-chip${item.status === "ready" ? " is-cleared" : ""}`}>
                            {item.status === "ready" ? <Tick /> : null}
                            {item.status === "ready" ? "Wipe complete" : "No obvious tags"}
                          </li>
                        ) : (
                          item.findings.map((finding) => (
                            <li
                              key={finding.id}
                              className={`finding-chip${item.status === "ready" ? " is-cleared" : ""}`}
                            >
                              {item.status === "ready" ? <Tick /> : null}
                              {finding.label}
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {items.length > 1 ? (
              <div className="toolbar" style={{ marginTop: "0.85rem" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void downloadAll()}
                  disabled={readyCount === 0 || packing || running}
                >
                  {packing
                    ? "Packing…"
                    : readyCount > 1
                      ? `Download all (${readyCount})`
                      : "Download all"}
                </button>
                <span className="muted">
                  {readyCount === 0
                    ? "Wipe first, then this packs every clean file into one zip"
                    : "One zip with every clean file"}
                </span>
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
              Wipe is for every file. Tick Companies House only on invoices or contracts.
              Bills, statements, and rental agreements can be wiped as they are. Files stay
              in memory, then are discarded.
            </p>
          </aside>
        </div>

        <footer className="page-foot">
          <p className="muted">
            Share this page:{" "}
            <span style={{ color: "var(--ink)", wordBreak: "break-all" }}>{share || "this link"}</span>
          </p>
          <p className="muted">
            Do not upload files you are not allowed to handle. The wipe removes hidden
            tags; it does not redact what is printed on the page.
          </p>
        </footer>
      </main>

      {toast !== "off" ? (
        <div className={`save-status ${toast === "saving" ? "saving" : "saved"}`} role="status">
          {toastLabel}
        </div>
      ) : null}
      {modalResults ? (
        <CompanyCheckModal
          results={modalResults}
          applying={applyingFixes}
          onCancel={() => setModalResults(null)}
          onProceed={() => void applyCheckAndWipe()}
        />
      ) : null}
    </div>
  );
}
