import { spawn } from "child_process";
import { performance } from "perf_hooks";

export type RunStatus = "OK" | "TLE" | "RE" | "OLE";

export interface RunResult {
  status: RunStatus;
  stdout: string;
  stderr: string;
  timeMs: number;
  exitCode: number | null;
  signal: string | null;
  /** Set when the program could not be started at all (e.g. compiler not installed). */
  spawnError?: string;
}

export interface RunOptions {
  timeoutMs: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Kill the program if stdout + stderr exceed this. Default 64 MB. */
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

/** Run a program with the given stdin. Never throws. */
export function runProcess(cmd: string[], input: string, opts: RunOptions): Promise<RunResult> {
  const maxOutput = opts.maxOutputBytes ?? 64 * 1024 * 1024;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let killedFor: "TLE" | "OLE" | "ABORT" | null = null;
    let done = false;

    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (r: Omit<RunResult, "stdout" | "stderr" | "timeMs">) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        ...r,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        timeMs: performance.now() - t0,
      });
    };

    const kill = (why: "TLE" | "OLE" | "ABORT") => {
      if (killedFor) return;
      killedFor = why;
      child.kill("SIGKILL");
      // If a grandchild keeps the pipes open, don't wait forever for 'close'.
      setTimeout(() => finish({ status: why === "OLE" ? "OLE" : "TLE", exitCode: null, signal: "SIGKILL" }), 2000).unref();
    };

    const onAbort = () => kill("ABORT");
    opts.signal?.addEventListener("abort", onAbort);
    if (opts.signal?.aborted) kill("ABORT");

    const timer = setTimeout(() => kill("TLE"), opts.timeoutMs);

    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutput) return kill("OLE");
      into.push(chunk);
    };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));

    child.on("error", (e) => {
      finish({ status: "RE", exitCode: null, signal: null, spawnError: e.message });
    });

    child.on("close", (code, sig) => {
      if (killedFor === "OLE") return finish({ status: "OLE", exitCode: code, signal: sig });
      if (killedFor) return finish({ status: "TLE", exitCode: code, signal: sig });
      if (code === 0) return finish({ status: "OK", exitCode: 0, signal: null });
      finish({ status: "RE", exitCode: code, signal: sig });
    });

    // The program may exit without reading all of stdin; that's fine.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const WINDOWS_CODES: Record<number, string> = {
  0xc0000005: "access violation (bad pointer / out-of-bounds index)",
  0xc00000fd: "stack overflow (recursion too deep)",
  0xc0000094: "integer division by zero",
  0xc0000095: "integer overflow",
  0xc000008c: "array bounds exceeded",
  0xc0000409: "abort / assertion failed / buffer overrun",
  0xc0000374: "heap corruption",
  0xc0000017: "out of memory",
  0xc000013a: "interrupted (Ctrl+C)",
};

const SIGNALS: Record<string, string> = {
  SIGSEGV: "segmentation fault (bad pointer / out-of-bounds index)",
  SIGFPE: "arithmetic error (division by zero)",
  SIGABRT: "abort / assertion failed",
  SIGBUS: "bus error",
  SIGKILL: "killed",
};

/** Human description of why a program exited, e.g. "exit code 0xC00000FD: stack overflow". */
export function describeExit(exitCode: number | null, signal: string | null): string {
  if (signal) return `signal ${signal}` + (SIGNALS[signal] ? `: ${SIGNALS[signal]}` : "");
  if (exitCode === null) return "no exit code";
  const u = exitCode >>> 0;
  if (u >= 0xc0000000) {
    const hex = "0x" + u.toString(16).toUpperCase();
    return `exit code ${hex}` + (WINDOWS_CODES[u] ? `: ${WINDOWS_CODES[u]}` : "");
  }
  if (exitCode === 134) return "exit code 134: abort / assertion failed";
  if (exitCode === 139) return "exit code 139: segmentation fault";
  return `exit code ${exitCode}`;
}
