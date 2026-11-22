import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { CompareOptions, Difference, firstDifference, outputsMatch } from "./compare";
import type { ProgramCache } from "./cache";
import { DEFAULT_TIME_MULTIPLIERS, LanguageId, languageOf, prepare, PrepareResult, Program, ToolPaths } from "./languages";
import { describeExit, runProcess } from "./runner";
import { DATA_DIR, loadDataDir, loadMeta, ProblemMeta, problemDirOf, TestCase } from "./tests";

/** AC = accepted, NO_EXPECTED = ran fine but there is no answer to compare with. */
export type Verdict = "AC" | "WA" | "TLE" | "RE" | "OLE" | "NO_EXPECTED";

export interface CaseResult {
  name: string;
  verdict: Verdict;
  timeMs: number;
  input: string;
  expected: string | null;
  output: string;
  stderr: string;
  /** For WA: the first differing line. */
  diff?: Difference;
  /** For RE: why it crashed. */
  message?: string;
}

export interface JudgeReport {
  /** Set when the solution did not compile; `cases` is then empty. */
  compileError?: string;
  /** What the compiler printed on a successful compile (warnings), if anything. */
  compileWarnings?: string;
  cases: CaseResult[];
  passed: number;
  total: number;
  /** The limit each case ran with: meta.json's timeLimit times the language's factor. */
  timeLimitMs: number;
}

export interface JudgeOptions {
  tools?: ToolPaths;
  /** Reuse compiled programs from here instead of compiling into a throwaway folder. */
  cache?: ProgramCache;
  /** Overrides meta.json (before the language factor is applied). */
  timeLimitMs?: number;
  /** Time limit factor per language; overrides meta.json's timeMultipliers and the defaults. */
  timeMultipliers?: Partial<Record<LanguageId, number>>;
  /** Overrides meta.json. */
  compare?: CompareOptions;
  /** Use these instead of reading the .data folder. */
  cases?: TestCase[];
  /** Only run cases with these names. */
  only?: string[];
  /** Called after each case finishes, for live progress. */
  onCase?: (result: CaseResult, index: number, total: number) => void;
  signal?: AbortSignal;
}

export const DEFAULT_TIME_LIMIT_MS = 2000;

/** The time limit for one case of this problem in this solution's language. */
export function timeLimitFor(
  solutionPath: string,
  meta: ProblemMeta,
  opts: { timeLimitMs?: number; timeMultipliers?: Partial<Record<LanguageId, number>> } = {},
): number {
  const base = opts.timeLimitMs ?? (meta.timeLimit ? meta.timeLimit * 1000 : DEFAULT_TIME_LIMIT_MS);
  const lang = languageOf(solutionPath);
  if (!lang) return base;
  const factor = [opts.timeMultipliers?.[lang], meta.timeMultipliers?.[lang], DEFAULT_TIME_MULTIPLIERS[lang]].find(
    (f): f is number => typeof f === "number" && f > 0 && Number.isFinite(f),
  )!;
  return Math.round(base * factor);
}

/** Compile the solution and run it against every test case of its problem. */
export async function judge(solutionPath: string, opts: JudgeOptions = {}): Promise<JudgeReport> {
  const problemDir = problemDirOf(solutionPath);
  const meta = await loadMeta(problemDir);
  const timeLimitMs = timeLimitFor(solutionPath, meta, opts);
  const compare: CompareOptions = {
    exact: meta.exact,
    ignoreCase: meta.ignoreCase,
    eps: meta.eps,
    ...opts.compare,
  };
  let cases = opts.cases ?? (await loadDataDir(path.join(problemDir, DATA_DIR)));
  if (opts.only?.length) cases = cases.filter((c) => opts.only!.includes(c.name));

  return withProgram(solutionPath, opts, async (prep) => {
    if (!prep.ok) return { compileError: prep.error, cases: [], passed: 0, total: cases.length, timeLimitMs };
    const results: CaseResult[] = [];
    for (const [i, c] of cases.entries()) {
      if (opts.signal?.aborted) break;
      const r = await runCase(prep.program, c, timeLimitMs, compare, opts.signal);
      if (opts.signal?.aborted) break; // a cancelled run looks like a TLE; drop it
      results.push(r);
      opts.onCase?.(r, i, cases.length);
    }
    return {
      ...(prep.warnings ? { compileWarnings: prep.warnings } : {}),
      cases: results,
      passed: results.filter((r) => r.verdict === "AC").length,
      total: cases.length,
      timeLimitMs,
    };
  });
}

/** Compile and run the solution on one custom input, with no comparison. */
export async function runOnInput(
  solutionPath: string,
  input: string,
  opts: { tools?: ToolPaths; cache?: ProgramCache; timeLimitMs?: number; signal?: AbortSignal } = {},
): Promise<(CaseResult & { compileWarnings?: string }) | { compileError: string }> {
  const timeLimitMs = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  return withProgram(solutionPath, opts, async (prep) => {
    if (!prep.ok) return { compileError: prep.error };
    const r = await runCase(prep.program, { name: "custom", input, expected: null }, timeLimitMs, {}, opts.signal);
    return prep.warnings ? { ...r, compileWarnings: prep.warnings } : r;
  });
}

/** Compile (or take from the cache) and call fn with the result. */
export async function withProgram<T>(
  solutionPath: string,
  opts: { tools?: ToolPaths; cache?: ProgramCache },
  fn: (prep: PrepareResult) => Promise<T>,
): Promise<T> {
  if (opts.cache) return fn(await opts.cache.get(solutionPath, opts.tools));
  const tools = opts.tools;
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "dsa-drill-"));
  try {
    return await fn(await prepare(path.resolve(solutionPath), workdir, tools));
  } finally {
    // On Windows the .exe can stay locked for a moment after it exits.
    await fs.rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

export async function runCase(
  program: Program,
  c: TestCase,
  timeLimitMs: number,
  compare: CompareOptions,
  signal?: AbortSignal,
): Promise<CaseResult> {
  const r = await runProcess(program.command, c.input, { timeoutMs: timeLimitMs, env: program.env, signal });
  const base = { name: c.name, timeMs: r.timeMs, input: c.input, expected: c.expected, output: r.stdout, stderr: r.stderr };

  if (r.spawnError) return { ...base, verdict: "RE", message: `Could not start the program: ${r.spawnError}` };
  if (r.status === "TLE") return { ...base, verdict: "TLE", timeMs: timeLimitMs };
  if (r.status === "OLE") return { ...base, verdict: "OLE", message: "Printed too much output." };
  if (r.status === "RE") return { ...base, verdict: "RE", message: describeExit(r.exitCode, r.signal) };
  if (c.expected === null) return { ...base, verdict: "NO_EXPECTED" };
  if (outputsMatch(r.stdout, c.expected, compare)) return { ...base, verdict: "AC" };
  return { ...base, verdict: "WA", diff: firstDifference(r.stdout, c.expected, compare) ?? undefined };
}
