import * as path from "path";
import { runProcess } from "./runner";

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
}

export type PrepareResult = { ok: true; program: Program } | { ok: false; error: string };

const INSTALL_HINT: Record<string, string> = {
  cpp: "Install g++ (MSYS2/MinGW on Windows, Xcode Command Line Tools on Mac, build-essential on Linux)",
  javac: "Install a JDK (e.g. Temurin)",
  java: "Install a JDK (e.g. Temurin)",
  python: "Install Python 3",
};

async function compile(cmd: string[], tool: keyof ToolPaths, cwd: string): Promise<string | null> {
  const r = await runProcess(cmd, "", { timeoutMs: 60_000, cwd });
  if (r.spawnError) return `'${cmd[0]}' could not be started (${r.spawnError}). ${INSTALL_HINT[tool]}, or set its path in the settings.`;
  if (r.status === "TLE") return "Compilation took longer than 60 s.";
  if (r.status !== "OK") return (r.stderr || r.stdout).trim() || `Compiler failed (exit code ${r.exitCode}).`;
  return null;
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
      // Windows gives programs a 1 MB stack; judges like Codeforces give 256 MB.
      if (IS_WIN) args.push("-Wl,--stack,268435456");
      const error = await compile([t.cpp, ...args], "cpp", workdir);
      return error ? { ok: false, error } : { ok: true, program: { language, command: [exe] } };
    }
    case "java": {
      const error = await compile([t.javac, "-encoding", "UTF-8", "-d", workdir, src], "javac", workdir);
      if (error) return { ok: false, error };
      return { ok: true, program: { language, command: [t.java, "-Xss256m", "-cp", workdir, stem] } };
    }
    case "python": {
      const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
      return { ok: true, program: { language, command: [t.python, src], env } };
    }
    default:
      return { ok: false, error: `Don't know how to run '${path.extname(src)}' files. Use C++, Java or Python.` };
  }
}

function stripEmpty(tools: ToolPaths): ToolPaths {
  return Object.fromEntries(Object.entries(tools).filter(([, v]) => typeof v === "string" && v.trim() !== ""));
}
