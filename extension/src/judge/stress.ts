/**
 * Stress test: run a generator with seeds 1..N, feed each input to the solution and to a slow but
 * obviously correct brute force, and stop at the first case where the solution disagrees, crashes
 * or is too slow. The helpers live next to the solution:
 *
 *   <problem>/gen.py     (or gen.cpp / Gen.java)     prints one random input; argv[1] is the seed
 *   <problem>/brute.cpp  (or brute.py / Brute.java)  reads the input, prints the right answer
 */
import { existsSync, promises as fs } from "fs";
import * as path from "path";
import type { ProgramCache } from "./cache";
import { CompareOptions } from "./compare";
import { findChecker } from "./checker";
import { CaseContext, CaseResult, memoryLimitFor, runCase, timeLimitFor, withChecker, withProgram } from "./judge";
import { getMemwatch } from "./memory";
import { LanguageId, languageOf, PrepareResult, Program, ToolPaths } from "./languages";
import { describeExit, runProcess, RunResult } from "./runner";
import { DATA_DIR, loadMeta, problemDirOf } from "./tests";

export const STRESS_HELPERS = ["gen", "brute"] as const;
export type StressHelper = (typeof STRESS_HELPERS)[number];

/** File names to create for a helper in a language (Java needs a capitalised class name). */
export function helperFileName(helper: StressHelper, language: LanguageId): string {
  return language === "java" ? helper[0].toUpperCase() + helper.slice(1) + ".java" : `${helper}.${language === "cpp" ? "cpp" : "py"}`;
}

export function isStressHelper(file: string): boolean {
  return (STRESS_HELPERS as readonly string[]).includes(path.parse(file).name.toLowerCase()) && !!languageOf(file);
}

/** gen.* and brute.* in the problem folder. Throws if there are several of one. */
export async function findStressHelpers(problemDir: string): Promise<Partial<Record<StressHelper, string>>> {
  const files = existsSync(problemDir) ? await fs.readdir(problemDir) : [];
  const out: Partial<Record<StressHelper, string>> = {};
  for (const h of STRESS_HELPERS) {
    const found = files.filter((f) => path.parse(f).name.toLowerCase() === h && languageOf(f));
    if (found.length > 1) throw new Error(`There are several ${h} files (${found.join(", ")}); keep one.`);
    if (found[0]) out[h] = path.join(problemDir, found[0]);
  }
  return out;
}

export type StressOutcome =
  /** The solution agreed with brute on every input. */
  | { kind: "passed"; runs: number }
  | { kind: "cancelled"; runs: number }
  | { kind: "missingHelpers"; missing: StressHelper[] }
  | { kind: "compileError"; file: string; error: string }
  /** gen or brute itself failed: fix the helper, not the solution. */
  | { kind: "helperFailed"; file: string; seed: number; message: string; input?: string }
  /** The first failing seed. result.expected is brute's output. */
  | { kind: "found"; seed: number; result: CaseResult; timeLimitMs: number; memoryLimitMb?: number; memoryMeasured: boolean; checker?: string };

export interface StressOptions {
  tools?: ToolPaths;
  cache?: ProgramCache;
  /** How many seeds to try (default 200). */
  runs?: number;
  timeLimitMs?: number;
  timeMultipliers?: Partial<Record<LanguageId, number>>;
  compare?: CompareOptions;
  /** Time limit for one gen or brute run (default 10 s). */
  helperTimeoutMs?: number;
  onProgress?: (seed: number, runs: number) => void;
  signal?: AbortSignal;
}

export async function stressTest(solutionPath: string, opts: StressOptions = {}): Promise<StressOutcome> {
  const runs = opts.runs ?? 200;
  const helperMs = opts.helperTimeoutMs ?? 10_000;
  const problemDir = problemDirOf(solutionPath);
  const helpers = await findStressHelpers(problemDir);
  const missing = STRESS_HELPERS.filter((h) => !helpers[h]);
  if (missing.length) return { kind: "missingHelpers", missing };

  const meta = await loadMeta(problemDir);
  const timeLimitMs = timeLimitFor(solutionPath, meta, opts);
  const compare: CompareOptions = { exact: meta.exact, ignoreCase: meta.ignoreCase, eps: meta.eps, ...opts.compare };
  const memoryLimitMb = memoryLimitFor(meta);
  const memwatch = await getMemwatch(opts.tools?.cpp);
  const checkerFile = await findChecker(problemDir);

  return withProgram(solutionPath, opts, (sol) =>
    withProgram(helpers.gen!, opts, (gen) =>
      withProgram(helpers.brute!, opts, (brute) => withChecker(checkerFile, opts, async (checker) => {
        const ctx: CaseContext = { timeLimitMs, compare, memoryLimitMb, memwatch, checker };
        for (const [file, p] of [[solutionPath, sol], [helpers.gen!, gen], [helpers.brute!, brute]] as [string, PrepareResult][]) {
          if (!p.ok) return { kind: "compileError", file, error: p.error };
        }
        const [s, g, b] = [sol, gen, brute].map((p) => (p as Extract<PrepareResult, { ok: true }>).program);

        for (let seed = 1; seed <= runs; seed++) {
          if (opts.signal?.aborted) return { kind: "cancelled", runs: seed - 1 };
          opts.onProgress?.(seed, runs);
          const gr = await runProcess([...g.command, String(seed)], "", { timeoutMs: helperMs, env: g.env, signal: opts.signal });
          if (opts.signal?.aborted) return { kind: "cancelled", runs: seed - 1 };
          const gErr = helperError(gr);
          if (gErr) return { kind: "helperFailed", file: helpers.gen!, seed, message: gErr };
          const input = normalise(gr.stdout);

          const br = await runProcess(b.command, input, { timeoutMs: helperMs, env: b.env, signal: opts.signal });
          if (opts.signal?.aborted) return { kind: "cancelled", runs: seed - 1 };
          const bErr = helperError(br);
          if (bErr) return { kind: "helperFailed", file: helpers.brute!, seed, message: bErr, input };

          const r = await runCase(s, { name: `stress-${seed}`, input, expected: br.stdout }, ctx, opts.signal);
          if (opts.signal?.aborted) return { kind: "cancelled", runs: seed - 1 };
          if (r.verdict !== "AC") {
            return { kind: "found", seed, result: r, timeLimitMs, memoryLimitMb, memoryMeasured: !!memwatch, ...(checkerFile ? { checker: path.basename(checkerFile) } : {}) };
          }
        }
        return { kind: "passed", runs };
      })),
    ),
  );
}

/** Save a failing stress case into .data so Run Tests includes it from now on. Returns the .in path. */
export async function saveStressCase(problemDir: string, name: string, input: string, expected: string): Promise<string> {
  const data = path.join(problemDir, DATA_DIR);
  await fs.mkdir(data, { recursive: true });
  const inFile = path.join(data, `${name}.in`);
  await fs.writeFile(inFile, input);
  await fs.writeFile(path.join(data, `${name}.out`), normalise(expected));
  return inFile;
}

function helperError(r: RunResult): string | null {
  if (r.spawnError) return `could not be started: ${r.spawnError}`;
  if (r.status === "TLE") return "took too long";
  if (r.status === "OLE") return "printed too much output";
  if (r.status === "RE") return `crashed (${describeExit(r.exitCode, r.signal)})` + (r.stderr.trim() ? `:\n${r.stderr.trim().split("\n").slice(-15).join("\n")}` : "");
  return null;
}

function normalise(s: string): string {
  const t = s.replace(/\r\n/g, "\n");
  return t === "" || t.endsWith("\n") ? t : t + "\n";
}

/** Starter templates for the helpers. */
export const HELPER_TEMPLATES: Record<StressHelper, Record<LanguageId, string>> = {
  gen: {
    python: `# Prints ONE random input for this problem. The seed is argv[1], so a failing case can be rerun.
# Keep it small (n up to ~8): small cases are easy to read when the stress test finds a bug.
import random, sys

random.seed(int(sys.argv[1]))
n = random.randint(1, 8)
print(n)
print(*(random.randint(-10, 10) for _ in range(n)))
`,
    cpp: `// Prints ONE random input for this problem. The seed is argv[1], so a failing case can be rerun.
// Keep it small (n up to ~8): small cases are easy to read when the stress test finds a bug.
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char** argv) {
    mt19937 rng(atoi(argv[1]));
    auto rnd = [&](int lo, int hi) { return uniform_int_distribution<int>(lo, hi)(rng); };
    int n = rnd(1, 8);
    printf("%d\\n", n);
    for (int i = 0; i < n; i++) printf("%d%c", rnd(-10, 10), i + 1 < n ? ' ' : '\\n');
}
`,
    java: `// Prints ONE random input for this problem. The seed is args[0], so a failing case can be rerun.
// Keep it small (n up to ~8): small cases are easy to read when the stress test finds a bug.
import java.util.*;

public class Gen {
    public static void main(String[] args) {
        Random rng = new Random(Long.parseLong(args[0]));
        int n = 1 + rng.nextInt(8);
        StringBuilder sb = new StringBuilder().append(n).append('\\n');
        for (int i = 0; i < n; i++) sb.append(rng.nextInt(21) - 10).append(i + 1 < n ? ' ' : '\\n');
        System.out.print(sb);
    }
}
`,
  },
  brute: {
    python: `# A slow but obviously correct solution: try everything. Its answers are taken as the truth.
import sys

def main():
    data = sys.stdin.read().split()
    # TODO: read the input and print the answer by brute force

main()
`,
    cpp: `// A slow but obviously correct solution: try everything. Its answers are taken as the truth.
#include <bits/stdc++.h>
using namespace std;

int main() {
    // TODO: read the input and print the answer by brute force
}
`,
    java: `// A slow but obviously correct solution: try everything. Its answers are taken as the truth.
import java.util.*;

public class Brute {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        // TODO: read the input and print the answer by brute force
    }
}
`,
  },
};
