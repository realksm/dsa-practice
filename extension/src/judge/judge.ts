import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { Checker, CheckerError, findChecker } from "./checker";
import { CompareOptions, Difference, firstDifference, outputsMatch } from "./compare";
import type { ProgramCache } from "./cache";
import { getMemwatch, runMeasured } from "./memory";
import { DEFAULT_TIME_MULTIPLIERS, LanguageId, languageOf, prepare, PrepareResult, Program, ToolPaths } from "./languages";
import { describeExit } from "./runner";
import { DATA_DIR, loadDataDir, loadMeta, ProblemMeta, problemDirOf, TestCase } from "./tests";

/** AC = accepted, MLE = memory limit exceeded, NO_EXPECTED = ran fine but there is no answer to compare with. */
export type Verdict = "AC" | "WA" | "TLE" | "MLE" | "RE" | "OLE" | "NO_EXPECTED";

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
  /** For RE / MLE: why it failed. For WA from a checker: what the checker said. */
  message?: string;
  /** Peak memory in bytes, when it could be measured (see memory.ts). */
  memoryBytes?: number;
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
  /** meta.json's memoryLimit, if it has one. */
  memoryLimitMb?: number;
  /** False when memory couldn't be measured (no g++ to build the helper): the limit wasn't checked. */
  memoryMeasured: boolean;
  /** The problem's checker file, if it has one. */
  checker?: string;
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
  /** Overrides meta.json's memoryLimit (megabytes); 0 = no limit. */
  memoryLimitMb?: number;
  /** Measure peak memory (default true). */
  measureMemory?: boolean;
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

/** meta.json's memory limit in MB (or the override), undefined for none. */
export function memoryLimitFor(meta: ProblemMeta, override?: number): number | undefined {
  const v = override ?? meta.memoryLimit;
  return typeof v === "number" && v > 0 && Number.isFinite(v) ? v : undefined;
}

/** Everything a case runs with besides the program and the case itself. */
export interface CaseContext {
  timeLimitMs: number;
  compare: CompareOptions;
  memoryLimitMb?: number;
  /** The memwatch helper; without it memory isn't measured. */
  memwatch?: string;
  checker?: Checker;
}

/** Compile the solution and run it against every test case of its problem. */
export async function judge(solutionPath: string, opts: JudgeOptions = {}): Promise<JudgeReport> {
  const problemDir = problemDirOf(solutionPath);
  const meta = await loadMeta(problemDir);
  const timeLimitMs = timeLimitFor(solutionPath, meta, opts);
  const memoryLimitMb = memoryLimitFor(meta, opts.memoryLimitMb);
  const compare: CompareOptions = {
    exact: meta.exact,
    ignoreCase: meta.ignoreCase,
    eps: meta.eps,
    ...opts.compare,
  };
  let cases = opts.cases ?? (await loadDataDir(path.join(problemDir, DATA_DIR)));
  if (opts.only?.length) cases = cases.filter((c) => opts.only!.includes(c.name));
  const checkerFile = await findChecker(problemDir);
  const memwatch = opts.measureMemory === false ? undefined : await getMemwatch(opts.tools?.cpp);
  const limits = {
    timeLimitMs,
    ...(memoryLimitMb ? { memoryLimitMb } : {}),
    memoryMeasured: !!memwatch,
    ...(checkerFile ? { checker: path.basename(checkerFile) } : {}),
  };

  return withProgram(solutionPath, opts, async (prep) => {
    if (!prep.ok) return { compileError: prep.error, cases: [], passed: 0, total: cases.length, ...limits };
    return withChecker(checkerFile, opts, async (checker) => {
      const ctx: CaseContext = { timeLimitMs, compare, memoryLimitMb, memwatch, checker };
      const results: CaseResult[] = [];
      for (const [i, c] of cases.entries()) {
        if (opts.signal?.aborted) break;
        const r = await runCase(prep.program, c, ctx, opts.signal);
        if (opts.signal?.aborted) break; // a cancelled run looks like a TLE; drop it
        results.push(r);
        opts.onCase?.(r, i, cases.length);
      }
      return {
        ...(prep.warnings ? { compileWarnings: prep.warnings } : {}),
        cases: results,
        passed: results.filter((r) => r.verdict === "AC").length,
        total: cases.length,
        ...limits,
      };
    });
  });
}

/** Compile the problem's checker (if it has one) and call fn with it. A checker that doesn't compile is an error. */
export async function withChecker<T>(
  file: string | undefined,
  opts: { tools?: ToolPaths; cache?: ProgramCache },
  fn: (checker: Checker | undefined) => Promise<T>,
): Promise<T> {
  if (!file) return fn(undefined);
  return withProgram(file, opts, async (prep) => {
    if (!prep.ok) throw new CheckerError(`The problem's checker (${path.basename(file)}) does not compile. This is a bug in the problem.\n${prep.error}`);
    const checker = await Checker.create(file, prep.program);
    try {
      return await fn(checker);
    } finally {
      await checker.dispose();
    }
  });
}

/** Compile and run the solution on one custom input, with no comparison. */
export async function runOnInput(
  solutionPath: string,
  input: string,
  opts: { tools?: ToolPaths; cache?: ProgramCache; timeLimitMs?: number; measureMemory?: boolean; signal?: AbortSignal } = {},
): Promise<(CaseResult & { compileWarnings?: string }) | { compileError: string }> {
  const timeLimitMs = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const memwatch = opts.measureMemory === false ? undefined : await getMemwatch(opts.tools?.cpp);
  return withProgram(solutionPath, opts, async (prep) => {
    if (!prep.ok) return { compileError: prep.error };
    const r = await runCase(prep.program, { name: "custom", input, expected: null }, { timeLimitMs, compare: {}, memwatch }, opts.signal);
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

export async function runCase(program: Program, c: TestCase, ctx: CaseContext, signal?: AbortSignal): Promise<CaseResult> {
  const r = await runMeasured(program, c.input, { timeoutMs: ctx.timeLimitMs, memoryLimitMb: ctx.memoryLimitMb, memwatch: ctx.memwatch, signal });
  const base = {
    name: c.name,
    timeMs: r.timeMs,
    input: c.input,
    expected: c.expected,
    output: r.stdout,
    stderr: r.stderr,
    ...(r.peakBytes !== undefined && Number.isFinite(r.peakBytes) ? { memoryBytes: r.peakBytes } : {}),
  };
  const limit = ctx.memoryLimitMb;
  // Java is capped with -Xmx (memory.ts), so only its OutOfMemoryError counts, not the JVM's own size.
  const overLimit = !!limit && program.language !== "java" && r.peakBytes !== undefined && r.peakBytes > limit * 1024 * 1024;

  if (r.spawnError) return { ...base, verdict: "RE", message: `Could not start the program: ${r.spawnError}` };
  if (r.status === "TLE") return { ...base, verdict: "TLE", timeMs: ctx.timeLimitMs };
  if (r.status === "OLE") return { ...base, verdict: "OLE", message: "Printed too much output." };
  if (limit && (r.memoryExceeded || overLimit)) return { ...base, verdict: "MLE", message: `Used more than the ${limit} MB memory limit.` };
  if (r.status === "RE") return { ...base, verdict: "RE", message: describeExit(r.exitCode, r.signal) };
  if (c.expected === null) return { ...base, verdict: "NO_EXPECTED" };
  if (ctx.checker) {
    const v = await ctx.checker.check(c.name, c.input, r.stdout, c.expected, signal);
    return v.ok ? { ...base, verdict: "AC" } : { ...base, verdict: "WA", message: v.message };
  }
  if (outputsMatch(r.stdout, c.expected, ctx.compare)) return { ...base, verdict: "AC" };
  return { ...base, verdict: "WA", diff: firstDifference(r.stdout, c.expected, ctx.compare) ?? undefined };
}
