import { promises as fs } from "fs";
import * as path from "path";

export interface TestCase {
  /** File stem, e.g. "01". */
  name: string;
  input: string;
  /** null when there is no .out/.ans file for this input. */
  expected: string | null;
}

export interface ProblemMeta {
  title?: string;
  difficulty?: string;
  tags?: string[];
  /** Seconds per test. */
  timeLimit?: number;
  /** Megabytes (informational for now). */
  memoryLimit?: number;
  /** Compare line by line instead of by tokens. */
  exact?: boolean;
  ignoreCase?: boolean;
  eps?: number;
  /** Time limit factor per language, e.g. { "java": 3 }. Defaults: DEFAULT_TIME_MULTIPLIERS. */
  timeMultipliers?: Partial<Record<"cpp" | "java" | "python", number>>;
}

export const DATA_DIR = ".data";

/** The problem folder is the folder that holds the solution file. */
export function problemDirOf(solutionPath: string): string {
  return path.dirname(path.resolve(solutionPath));
}

/** Load NN.in / NN.out (or NN.ans) pairs from a folder, in natural order (2 before 10). */
export async function loadDataDir(dir: string): Promise<TestCase[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`No ${DATA_DIR} folder found at ${dir}`);
  }
  const ins = entries
    .filter((f) => f.toLowerCase().endsWith(".in"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const has = new Set(entries);
  const cases: TestCase[] = [];
  for (const file of ins) {
    const name = file.slice(0, -3);
    const outFile = [name + ".out", name + ".ans"].find((f) => has.has(f));
    cases.push({
      name,
      input: await fs.readFile(path.join(dir, file), "utf8"),
      expected: outFile ? await fs.readFile(path.join(dir, outFile), "utf8") : null,
    });
  }
  return cases;
}

export async function loadMeta(problemDir: string): Promise<ProblemMeta> {
  try {
    return JSON.parse(await fs.readFile(path.join(problemDir, "meta.json"), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`meta.json in ${problemDir} is not valid JSON: ${(e as Error).message}`);
  }
}
