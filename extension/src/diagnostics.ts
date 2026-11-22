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

/**
 * Where a crashed program died in `source`, from a Python traceback or a Java stack trace on stderr.
 * Python: the last `File "...", line N` frame in the source (tracebacks list the innermost call last).
 * Java: the first `at ...(Main.java:N)` frame (stack traces list the innermost call first).
 * The message is the exception line, e.g. "ZeroDivisionError: division by zero".
 */
export function parseRuntimeError(stderr: string, source: string): CompileMessage | undefined {
  const lines = stderr.replace(/\r\n?/g, "\n").split("\n");
  const ext = path.extname(source).toLowerCase();
  if (ext === ".py") {
    let line: number | undefined;
    for (const l of lines) {
      const m = /^\s*File "(.+)", line (\d+)/.exec(l);
      if (m && sameFile(m[1], source)) line = +m[2];
    }
    if (line === undefined) return;
    const last = [...lines].reverse().find((l) => /^\S/.test(l) && !/^Traceback /.test(l))?.trim();
    return { file: source, line, column: 1, severity: "error", message: last || "Runtime error" };
  }
  if (ext === ".java") {
    const base = path.basename(source);
    let line: number | undefined;
    for (const l of lines) {
      const m = /^\s*at .+\((.+?):(\d+)\)\s*$/.exec(l);
      if (m && m[1].toLowerCase() === base.toLowerCase()) {
        line = +m[2];
        break;
      }
    }
    if (line === undefined) return;
    const head = lines.find((l) => /^(Exception in thread "[^"]*" )?[\w$.]+(Exception|Error)\b/.test(l));
    const message = head?.replace(/^Exception in thread "[^"]*" /, "").trim() || "Runtime error";
    return { file: source, line, column: 1, severity: "error", message };
  }
  return;
}
