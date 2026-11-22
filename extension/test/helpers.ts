import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";

/** Create a throwaway problem folder: files maps relative path -> content. */
export function makeProblem(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dsa-drill-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

export function has(tool: string, ...args: string[]): boolean {
  const r = spawnSync(tool, args.length ? args : ["--version"], { stdio: "ignore", windowsHide: true });
  return !r.error && r.status === 0;
}

export const PY = process.platform === "win32" ? "python" : "python3";
export const HAS_GPP = has("g++");
export const HAS_JAVA = has("javac", "-version") && has("java", "-version");
export const HAS_PY = has(PY);

/** An in-memory stand-in for vscode.Memento. */
export function memento(): { data: Record<string, unknown>; get<T>(k: string, d: T): T; update(k: string, v: unknown): Promise<void> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: <T>(k: string, d: T) => (k in data ? (data[k] as T) : d),
    update: async (k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v)); // like VS Code: stored as JSON
    },
  };
}
