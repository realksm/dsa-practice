import { existsSync } from "fs";
import * as path from "path";
import { addr2lineFor, getCrashReporter, reporterArgs } from "./crash";
import { runProcess } from "./runner";
import { stdcppArgs } from "./stdcpp";

export type LanguageId = "cpp" | "java" | "python";

export const LANGUAGES: Record<LanguageId, { name: string; extensions: string[]; solutionFile: string }> = {
  cpp: { name: "C++", extensions: [".cpp", ".cc", ".cxx"], solutionFile: "solution.cpp" },
  java: { name: "Java", extensions: [".java"], solutionFile: "Main.java" },
  python: { name: "Python", extensions: [".py"], solutionFile: "solution.py" },
};

/** Commands used to compile and run. Each can be a full path. */
export interface ToolPaths {
  cpp?: string;
  javac?: string;
  java?: string;
  python?: string;
}

const IS_WIN = process.platform === "win32";

export const DEFAULT_TOOLS: Required<ToolPaths> = {
  cpp: "g++",
  javac: "javac",
  java: "java",
  python: IS_WIN ? "python" : "python3",
};

export function languageOf(file: string): LanguageId | undefined {
  const ext = path.extname(file).toLowerCase();
  return (Object.keys(LANGUAGES) as LanguageId[]).find((id) => LANGUAGES[id].extensions.includes(ext));
}

export interface Program {
  language: LanguageId;
  /** Command that runs the compiled program. */
  command: string[];
  env?: NodeJS.ProcessEnv;
  /** C++ built with the crash reporter (crash.ts): how to turn its stack addresses into lines. */
  crash?: { exe: string; source: string; addr2line: string[] };
}

/** `warnings`: what the compiler printed on a successful compile (empty if nothing). */
export type PrepareResult = { ok: true; program: Program; warnings: string } | { ok: false; error: string };

/**
 * Time limits in meta.json are set from a C++ reference. Java pays ~100 ms of JVM startup per case
 * (and runs slower on small inputs), so by default it gets twice the limit.
 */
export const DEFAULT_TIME_MULTIPLIERS: Record<LanguageId, number> = { cpp: 1, java: 2, python: 1 };

const INSTALL_HINT: Record<string, string> = {
  cpp: "Install g++ (MSYS2/MinGW on Windows, Xcode Command Line Tools on Mac, build-essential on Linux)",
  javac: "Install a JDK (e.g. Temurin)",
  java: "Install a JDK (e.g. Temurin)",
  python: "Install Python 3",
};

async function compile(cmd: string[], tool: keyof ToolPaths, cwd: string): Promise<{ error: string } | { warnings: string }> {
  const r = await runProcess(cmd, "", { timeoutMs: 60_000, cwd });
  if (r.spawnError) return { error: `'${cmd[0]}' could not be started (${r.spawnError}). ${INSTALL_HINT[tool]}, or set its path in the settings.` };
  if (r.status === "TLE") return { error: "Compilation took longer than 60 s." };
  if (r.status !== "OK") return { error: (r.stderr || r.stdout).trim() || `Compiler failed (exit code ${r.exitCode}).` };
  return { warnings: (r.stderr + r.stdout).trim() };
}

/** Compile `src` into `workdir` (if needed) and return how to run it. */
export async function prepare(src: string, workdir: string, tools: ToolPaths = {}): Promise<PrepareResult> {
  const t = { ...DEFAULT_TOOLS, ...stripEmpty(tools) };
  const language = languageOf(src);
  const stem = path.basename(src, path.extname(src));

  switch (language) {
    case "cpp": {
      const exe = path.join(workdir, stem + (IS_WIN ? ".exe" : ""));
      const args = ["-std=c++17", "-O2", "-Wall", "-o", exe, src];
      // Windows gives programs a 1 MB stack; judges like Codeforces give 256 MB. -static: otherwise
      // the program loads whichever libstdc++-6.dll comes first on PATH (Git's mingw64 one, say),
      // which crashes programs built by a different MinGW.
      if (IS_WIN) args.push("-Wl,--stack,268435456", "-static");
      // Mac: memwatch's setrlimit is capped at the 64 MB hard limit, so ask the linker for 256 MB,
      // and supply <bits/stdc++.h>, which Apple clang lacks (stdcpp.ts).
      if (process.platform === "darwin") args.push("-Wl,-stack_size,0x10000000", ...(await stdcppArgs()));
      // -g + the crash reporter: a crash prints where it happened (crash.ts). Same speed.
      const reporter = await getCrashReporter(t.cpp);
      if (reporter) args.push(...reporterArgs(reporter));
      const c = await compile([t.cpp, ...args], "cpp", workdir);
      if ("error" in c) return { ok: false, error: c.error };
      const crash = reporter ? { exe, source: src, addr2line: addr2lineFor(t.cpp) } : undefined;
      return { ok: true, program: { language, command: [exe], ...(crash ? { crash } : {}) }, warnings: c.warnings };
    }
    case "java": {
      const c = await compile([t.javac, "-encoding", "UTF-8", "-d", workdir, src], "javac", workdir);
      if ("error" in c) return { ok: false, error: c.error };
      return { ok: true, program: { language, command: [t.java, "-Xss256m", "-cp", workdir, stem] }, warnings: c.warnings };
    }
    case "python": {
      const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
      return { ok: true, program: { language, command: [await resolvePython(t.python), src], env }, warnings: "" };
    }
    default:
      return { ok: false, error: `Don't know how to run '${path.extname(src)}' files. Use C++, Java or Python.` };
  }
}

const resolvedPython = new Map<string, Promise<string>>();

/**
 * The interpreter's real path (sys.executable). On Windows "python" is often a launcher (the Store
 * alias, py) that starts the real interpreter as a separate process: then the time limit and Stop
 * kill only the launcher and memory can't be measured, and every case pays for the extra start.
 * Falls back to the command as given.
 */
export function resolvePython(cmd: string): Promise<string> {
  let p = resolvedPython.get(cmd);
  if (!p) {
    p = runProcess([cmd, "-c", "import sys; print(sys.executable)"], "", { timeoutMs: 15_000 }).then((r) => {
      const exe = r.status === "OK" ? r.stdout.trim() : "";
      if (exe && path.isAbsolute(exe) && existsSync(exe)) return exe;
      resolvedPython.delete(cmd); // try again next time (e.g. after installing Python)
      return cmd;
    });
    resolvedPython.set(cmd, p);
  }
  return p;
}

export function stripEmpty(tools: ToolPaths): ToolPaths {
  return Object.fromEntries(Object.entries(tools).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
}
