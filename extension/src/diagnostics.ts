/**
 * Turns compiler output into locations for the Problems panel.
 * Pure (no vscode import) so it can be unit tested.
 */
import * as path from "path";

export interface CompileMessage {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based; 1 when the compiler doesn't say. */
  column: number;
  severity: "error" | "warning";
  message: string;
}

// g++:   solution.cpp:5:10: error: 'x' was not declared in this scope
// javac: Main.java:5: error: cannot find symbol
const GCC = /^(.+?):(\d+):(\d+):\s*(fatal error|error|warning):\s*(.*)$/;
const JAVAC = /^(.+?\.java):(\d+):\s*(error|warning):\s*(.*)$/;

export function parseCompileErrors(output: string): CompileMessage[] {
  const out: CompileMessage[] = [];
  const lines = output.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = GCC.exec(l);
    if (m) {
      out.push({
        file: m[1],
        line: +m[2],
        column: +m[3],
        severity: m[4] === "warning" ? "warning" : "error",
        message: m[5],
      });
      continue;
    }
    m = JAVAC.exec(l);
    if (m) {
      // javac puts the details ("symbol: variable x") on the following indented lines
      // after the source line and caret line; keep the first of those.
      let message = m[4];
      const detail = lines[i + 3];
      if (detail && /^\s+\S/.test(detail) && /^\s*\^\s*$/.test(lines[i + 2] ?? "")) message += ` (${detail.trim()})`;
      out.push({ file: m[1], line: +m[2], column: 1, severity: m[3] === "warning" ? "warning" : "error", message });
    }
  }
  return out;
}

/** Whether a path printed by the compiler refers to `source`. */
export function sameFile(printed: string, source: string): boolean {
  const a = path.resolve(printed).toLowerCase();
  const b = path.resolve(source).toLowerCase();
  return a === b || path.basename(printed).toLowerCase() === path.basename(source).toLowerCase();
}
