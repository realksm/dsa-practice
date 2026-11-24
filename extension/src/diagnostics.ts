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
 * C++: a failed assert's own line, else the first frame of the crash reporter's trace (judge/crash.ts);
 * the message is the uncaught exception if there was one, else `fallbackMessage` (the exit reason).
 * The message is the exception line, e.g. "ZeroDivisionError: division by zero".
 */
export function parseRuntimeError(stderr: string, source: string, fallbackMessage?: string): CompileMessage | undefined {
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
  if ([".cpp", ".cc", ".cxx"].includes(ext)) {
    // A failed assert names its own line: MinGW "Assertion failed: x, file F, line N",
    // glibc "prog: F:N: func: Assertion `x' failed.", Mac "Assertion failed: (x), function f, file F, line N."
    for (const l of lines) {
      const apple = /^Assertion failed: \((.*)\), function .*, file (.+), line (\d+)\.\s*$/.exec(l);
      if (apple && sameFile(apple[2], source)) return { file: source, line: +apple[3], column: 1, severity: "error", message: `Assertion failed: ${apple[1]}` };
      const mingw = /^Assertion failed: (.*), file (.+), line (\d+)\s*$/.exec(l);
      if (mingw && sameFile(mingw[2], source)) return { file: source, line: +mingw[3], column: 1, severity: "error", message: `Assertion failed: ${mingw[1]}` };
      const glibc = /^.*?: (.+?):(\d+): .*Assertion [`'](.*)' failed\.\s*$/.exec(l);
      if (glibc && sameFile(glibc[1], source)) return { file: source, line: +glibc[2], column: 1, severity: "error", message: `Assertion failed: ${glibc[3]}` };
    }
    // The crash reporter's trace (judge/crash.ts), innermost call first.
    const base = path.basename(source).toLowerCase();
    for (const l of lines) {
      const m = /^\s+at .+ \((.+?):(\d+)\)(\s+x\d+)?\s*$/.exec(l);
      if (m && path.basename(m[1]).toLowerCase() === base) {
        const what = lines.find((x) => /^\s*what\(\):/.test(x))?.trim();
        const thrown = /terminate called after throwing an instance of '(.+)'/.exec(stderr)?.[1];
        // libc++ (Mac): "libc++abi: terminating due to uncaught exception of type std::out_of_range: vector"
        const libcxx = /libc\+\+abi: terminating (?:due to|with) uncaught exception of type ([^\r\n]+?)(?:: ([^\r\n]*))?\r?$/m.exec(stderr);
        const message = thrown
          ? `${thrown}${what ? ` (${what.replace(/^what\(\):\s*/, "")})` : ""}`
          : libcxx
            ? `${libcxx[1].trim()}${libcxx[2]?.trim() ? ` (${libcxx[2].trim()})` : ""}`
            : fallbackMessage || "Runtime error";
        return { file: source, line: +m[2], column: 1, severity: "error", message };
      }
    }
  }
  return;
}
