/**
 * Generate expected outputs and rebuild index.json.
 *
 *   npm run build                     every problem
 *   npm run build -- two-sum          only these problems (index.json is still rebuilt for all)
 *   npm run build -- --stress         also compare ref with naive on 200 random inputs from gen.*
 *   npm run build -- --stress 1000    ... on 1000 inputs
 *
 * For each problem it compiles references/<slug>/ref.* , runs it on every .data/*.in, writes
 * the matching .out, and checks that the reference fits in meta.json's timeLimit. A problem with a
 * .data/checker.* must accept the reference's own outputs; --stress then compares naive with ref
 * through the checker instead of token by token. Then it
 * validates the folder (the same checks CI runs) and rewrites index.json.
 * Nothing is written to index.json if anything failed.
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { Checker, CheckerError, findChecker } from "../extension/src/judge/checker";
import { outputsMatch } from "../extension/src/judge/compare";
import { languageOf, prepare, type Program } from "../extension/src/judge/languages";
import { describeExit, runProcess, type RunResult } from "../extension/src/judge/runner";
import { DATA_DIR, loadMeta, type ProblemMeta } from "../extension/src/judge/tests";
import { buildIndex, INDEX_FILE, indexText } from "../extension/src/problems/indexFile";
import { exists, natural, PROBLEMS, problemSlugs, REFERENCES, ROOT, validateProblem } from "./common";

const DEFAULT_TIME_LIMIT_S = 2;
const DEFAULT_STRESS_RUNS = 200;
/** A reference slower than this share of the limit gets a warning: Java/Python users have less headroom. */
const SLOW_SHARE = 0.5;

class Failure extends Error {}

interface Totals {
  errors: number;
  warnings: number;
}

function parseArgs(argv: string[]) {
  const slugs: string[] = [];
  let stress = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stress") {
      const n = Number(argv[i + 1]);
      if (Number.isInteger(n) && n > 0) {
        stress = n;
        i++;
      } else stress = DEFAULT_STRESS_RUNS;
    } else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else slugs.push(a);
  }
  return { slugs, stress };
}

/** references/<slug>/<stem>.{cpp,java,py}; Java files are capitalised (Ref.java). */
async function findHelper(refDir: string, stem: string): Promise<string | undefined> {
  const files = (await exists(refDir)) ? await fs.readdir(refDir) : [];
  const found = files.filter((f) => path.parse(f).name.toLowerCase() === stem && languageOf(f));
  if (found.length > 1) throw new Failure(`references/${path.basename(refDir)} has several ${stem} files (${found.join(", ")}); keep one.`);
  return found[0] && path.join(refDir, found[0]);
}

async function compile(src: string, workdir: string): Promise<Program> {
  const dir = path.join(workdir, path.parse(src).name.toLowerCase());
  await fs.mkdir(dir, { recursive: true });
  const r = await prepare(src, dir);
  if (!r.ok) throw new Failure(`${path.basename(src)} does not compile:\n${indent(r.error)}`);
  return r.program;
}

function run(p: Program, input: string, timeoutMs: number, args: string[] = []): Promise<RunResult> {
  return runProcess([...p.command, ...args], input, { timeoutMs, env: p.env });
}

function failed(r: RunResult, what: string): string | null {
  if (r.spawnError) return `${what} could not be started: ${r.spawnError}`;
  if (r.status === "TLE") return `${what} did not finish`;
  if (r.status === "OLE") return `${what} printed too much output`;
  if (r.status === "RE") return `${what} crashed (${describeExit(r.exitCode, r.signal)})` + (r.stderr.trim() ? `:\n${indent(tail(r.stderr))}` : "");
  return null;
}

const normalise = (s: string) => {
  const t = s.replace(/\r\n/g, "\n");
  return t.endsWith("\n") || t === "" ? t : t + "\n";
};
const indent = (s: string) => s.replace(/\s+$/, "").split("\n").map((l) => "      " + l).join("\n");
const tail = (s: string, n = 15) => s.trim().split("\n").slice(-n).join("\n");
const preview = (s: string, n = 20) => {
  const ls = s.replace(/\s+$/, "").split("\n");
  return ls.length > n ? [...ls.slice(0, n), `... (${ls.length - n} more lines)`].join("\n") : ls.join("\n");
};

async function buildProblem(slug: string, stressRuns: number, totals: Totals): Promise<void> {
  const dir = path.join(PROBLEMS, slug);
  const dataDir = path.join(dir, DATA_DIR);
  const refDir = path.join(REFERENCES, slug);
  const warn = (m: string) => {
    totals.warnings++;
    console.log(`    warning: ${m}`);
  };

  const ref = await findHelper(refDir, "ref");
  if (!ref) throw new Failure(`no reference solution: add references/${slug}/ref.cpp (or ref.py / Ref.java)`);
  const meta: ProblemMeta = await loadMeta(dir);
  const limitMs = (meta.timeLimit ?? DEFAULT_TIME_LIMIT_S) * 1000;
  const compareOpts = { exact: meta.exact, ignoreCase: meta.ignoreCase, eps: meta.eps };

  const ins = (await exists(dataDir)) ? (await fs.readdir(dataDir)).filter((f) => f.endsWith(".in")).sort(natural) : [];
  if (!ins.length) throw new Failure(`no tests: add ${DATA_DIR}/01.in, 02.in, ...`);

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "dsa-drill-build-"));
  let checker: Checker | undefined;
  try {
    const refProg = await compile(ref, workdir);
    const checkerFile = await findChecker(dir).catch((e) => {
      throw new Failure((e as Error).message);
    });
    if (checkerFile) checker = await Checker.create(checkerFile, await compile(checkerFile, workdir));
    let written = 0;
    let slowest = 0;
    for (const f of ins) {
      const input = await fs.readFile(path.join(dataDir, f), "utf8");
      // Run past the limit so a slow reference reports its real time instead of just "TLE".
      const r = await run(refProg, input, Math.max(limitMs * 4, 10_000));
      const err = failed(r, `${path.basename(ref)} on ${f}`);
      if (err) throw new Failure(err);
      slowest = Math.max(slowest, r.timeMs);
      if (r.timeMs > limitMs) throw new Failure(`${path.basename(ref)} took ${Math.round(r.timeMs)} ms on ${f}; the limit is ${limitMs} ms. Speed it up or raise timeLimit.`);
      if (r.timeMs > limitMs * SLOW_SHARE) warn(`${f}: reference took ${Math.round(r.timeMs)} ms of ${limitMs} ms; slower languages may not fit`);
      if (!r.stdout.trim()) warn(`${f}: reference printed nothing`);

      const outFile = path.join(dataDir, f.slice(0, -3) + ".out");
      const out = normalise(r.stdout);
      if (checker) {
        const v = await runChecker(checker, f, input, out, out);
        if (!v.ok) throw new Failure(`the checker rejects the reference's own output on ${f}:\n${indent(v.message)}`);
      }
      const old = await fs.readFile(outFile, "utf8").catch(() => null);
      if (old !== null && normalise(old) === out) continue;
      await fs.writeFile(outFile, out);
      written++;
      console.log(`    ${old === null ? "new    " : "CHANGED"} ${path.basename(outFile)}`);
    }
    console.log(
      `    ${ins.length} tests, ${written} .out written, slowest ${Math.round(slowest)} ms (limit ${limitMs} ms)` +
        (checker ? `; ${path.basename(checker.file)} accepts every reference output` : ""),
    );

    if (stressRuns > 0) await stress(slug, refDir, refProg, workdir, stressRuns, compareOpts, warn, checker);
  } finally {
    await checker?.dispose();
    // Windows can keep a just-run .exe locked for a moment.
    await fs.rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

async function stress(
  slug: string,
  refDir: string,
  refProg: Program,
  workdir: string,
  runs: number,
  compareOpts: { exact?: boolean; ignoreCase?: boolean; eps?: number },
  warn: (m: string) => void,
  checker?: Checker,
): Promise<void> {
  const gen = await findHelper(refDir, "gen");
  const naive = await findHelper(refDir, "naive");
  if (!gen || !naive) {
    warn(`stress test skipped: needs references/${slug}/gen.* and naive.*`);
    return;
  }
  const genProg = await compile(gen, workdir);
  const naiveProg = await compile(naive, workdir);
  for (let seed = 1; seed <= runs; seed++) {
    const g = await run(genProg, "", 10_000, [String(seed)]);
    const gErr = failed(g, `${path.basename(gen)} ${seed}`);
    if (gErr) throw new Failure(gErr);
    const input = normalise(g.stdout);
    const [r, n] = await Promise.all([run(refProg, input, 10_000), run(naiveProg, input, 10_000)]);
    const err = failed(r, `ref on seed ${seed}`) ?? failed(n, `naive on seed ${seed}`);
    if (err) throw new Failure(err);
    // with a checker, naive's output must be accepted against ref's (they may differ and both be right)
    const verdict = checker ? await runChecker(checker, `seed ${seed}`, input, n.stdout, r.stdout) : { ok: outputsMatch(r.stdout, n.stdout, compareOpts) };
    if (!verdict.ok) {
      const saved = path.join(refDir, `stress-${seed}.in`);
      await fs.writeFile(saved, input);
      throw new Failure(
        `ref and naive disagree on seed ${seed} (input saved to references/${slug}/${path.basename(saved)}):\n` +
          `    input:\n${indent(preview(input))}\n    ref:\n${indent(preview(r.stdout))}\n    naive:\n${indent(preview(n.stdout))}` +
          ("message" in verdict ? `\n    checker:\n${indent(verdict.message)}` : ""),
      );
    }
  }
  console.log(`    stress: ref and naive agree on ${runs} random inputs`);
}

/** Run the checker; a broken checker is a build failure, not an exception. */
async function runChecker(checker: Checker, what: string, input: string, output: string, answer: string) {
  try {
    return await checker.check(what, input, output, answer);
  } catch (e) {
    if (e instanceof CheckerError) throw new Failure(e.message.replace(" This is a bug in the problem, not your solution.", ""));
    throw e;
  }
}

async function main() {
  const { slugs: asked, stress: stressRuns } = parseArgs(process.argv.slice(2));
  const all = await problemSlugs();
  for (const s of asked) if (!all.includes(s)) throw new Error(`No problem problems/${s}`);
  const slugs = asked.length ? asked : all;
  const totals: Totals = { errors: 0, warnings: 0 };

  for (const slug of slugs) {
    console.log(`\n${slug}`);
    try {
      await buildProblem(slug, stressRuns, totals);
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      totals.errors++;
      console.log(`    ERROR: ${e.message}`);
    }
    for (const m of await validateProblem(slug)) {
      totals.errors++;
      console.log(`    ERROR: ${m}`);
    }
  }

  const { index, skipped, warnings } = await buildIndex(ROOT);
  for (const s of skipped) console.log(`\n  not in index: ${s.slug} (${s.reason})`);
  for (const w of warnings) console.log(`  index warning: ${w.slug}: ${w.message}`);

  console.log("");
  if (totals.errors) {
    console.error(`${totals.errors} error(s); ${INDEX_FILE} was not touched. Fix them and run npm run build again.`);
    process.exit(1);
  }
  const file = path.join(ROOT, INDEX_FILE);
  const text = indexText(index);
  const old = await fs.readFile(file, "utf8").catch(() => "");
  if (old.replace(/\r\n/g, "\n") === text) console.log(`${INDEX_FILE} unchanged (${index.problems.length} problems).`);
  else {
    await fs.writeFile(file, text);
    console.log(`Wrote ${INDEX_FILE} (${index.problems.length} problems).`);
  }
  if (totals.warnings) console.log(`${totals.warnings} warning(s) above.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
