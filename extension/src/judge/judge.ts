import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { CompareOptions, Difference, firstDifference, outputsMatch } from "./compare";
import { prepare, Program, ToolPaths } from "./languages";
import { describeExit, runProcess } from "./runner";
import { DATA_DIR, loadDataDir, loadMeta, problemDirOf, TestCase } from "./tests";

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
  cases: CaseResult[];
  passed: number;
  total: number;
  timeLimitMs: number;
}

export interface JudgeOptions {
  tools?: ToolPaths;
  /** Overrides meta.json. */
  timeLimitMs?: number;
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

const DEFAULT_TIME_LIMIT_MS = 2000;

/** Compile the solution and run it against every test case of its problem. */
export async function judge(solutionPath: string, opts: JudgeOptions = {}): Promise<JudgeReport> {
  const problemDir = problemDirOf(solutionPath);
  const meta = await loadMeta(problemDir);
  const timeLimitMs = opts.timeLimitMs ?? (meta.timeLimit ? meta.timeLimit * 1000 : DEFAULT_TIME_LIMIT_MS);
  const compare: CompareOptions = {
    exact: meta.exact,
    ignoreCase: meta.ignoreCase,
    eps: meta.eps,
    ...opts.compare,
  };
  let cases = opts.cases ?? (await loadDataDir(path.join(problemDir, DATA_DIR)));
  if (opts.only?.length) cases = cases.filter((c) => opts.only!.includes(c.name));

  return withProgram(solutionPath, opts.tools, async (prep) => {
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
  opts: { tools?: ToolPaths; timeLimitMs?: number; signal?: AbortSignal } = {},
): Promise<CaseResult | { compileError: string }> {
  const timeLimitMs = opts.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  return withProgram(solutionPath, opts.tools, async (prep) => {
    if (!prep.ok) return { compileError: prep.error };
    return runCase(prep.program, { name: "custom", input, expected: null }, timeLimitMs, {}, opts.signal);
  });
}

async function withProgram<T>(
  solutionPath: string,
  tools: ToolPaths | undefined,
  fn: (prep: Awaited<ReturnType<typeof prepare>>) => Promise<T>,
): Promise<T> {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "dsa-drill-"));
  try {
    return await fn(await prepare(path.resolve(solutionPath), workdir, tools));
  } finally {
    // On Windows the .exe can stay locked for a moment after it exits.
    await fs.rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

async function runCase(
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
