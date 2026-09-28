import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function toolRoot() {
  return path.resolve(process.cwd(), "..");
}

export function exiftoolPath() {
  return path.join(toolRoot(), "exiftool", "exiftool.exe");
}

export function qpdfPath() {
  return path.join(toolRoot(), "qpdf", "qpdf.exe");
}

export function nativeToolsAvailable() {
  return fs.existsSync(exiftoolPath()) && fs.existsSync(qpdfPath());
}

export function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
