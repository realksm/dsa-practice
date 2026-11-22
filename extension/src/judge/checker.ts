/**
 * Custom checkers, for problems where more than one output is right (any valid pair, any shortest
 * path, ...). A problem has one when its .data folder holds checker.cpp (or checker.py / checker.java).
 *
 * The checker is run as   checker <input file> <output file> <answer file>   (the testlib order;
 * the answer is the .out file, or brute's output in a stress test). Exit code 0 = accepted,
 * 1 or 2 = wrong answer (what it printed is shown as the reason), anything else = the checker
 * itself failed, which is the problem author's bug: the run stops with an error.
 */
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { languageOf, Program } from "./languages";
import { describeExit, runProcess } from "./runner";
import { DATA_DIR } from "./tests";

export const CHECKER_STEM = "checker";
const CHECKER_TIMEOUT_MS = 10_000;

/** .data/checker.* of a problem folder, if it has one. Throws if there are several. */
export async function findChecker(problemDir: string): Promise<string | undefined> {
  const data = path.join(problemDir, DATA_DIR);
  const files = await fs.readdir(data).catch(() => [] as string[]);
  const found = files.filter((f) => path.parse(f).name.toLowerCase() === CHECKER_STEM && languageOf(f));
  if (found.length > 1) throw new Error(`${DATA_DIR} has several checkers (${found.join(", ")}); keep one.`);
  return found[0] && path.join(data, found[0]);
}

export class CheckerError extends Error {}

export type CheckResult = { ok: true } | { ok: false; message: string };

/** A compiled checker plus a scratch folder for the three files it reads. Call dispose() when done. */
export class Checker {
  private constructor(
    readonly file: string,
    private readonly program: Program,
    private readonly dir: string,
  ) {}

  static async create(file: string, program: Program): Promise<Checker> {
    return new Checker(file, program, await fs.mkdtemp(path.join(os.tmpdir(), "dsa-drill-check-")));
  }

  async check(caseName: string, input: string, output: string, answer: string, signal?: AbortSignal): Promise<CheckResult> {
    const [inF, outF, ansF] = ["input.txt", "output.txt", "answer.txt"].map((f) => path.join(this.dir, f));
    await Promise.all([fs.writeFile(inF, input), fs.writeFile(outF, output), fs.writeFile(ansF, answer)]);
    const r = await runProcess([...this.program.command, inF, outF, ansF], "", { timeoutMs: CHECKER_TIMEOUT_MS, env: this.program.env, signal });
    if (signal?.aborted) return { ok: true }; // the caller drops a cancelled case anyway
    const said = (r.stdout + (r.stdout && r.stderr ? "\n" : "") + r.stderr).trim();
    if (r.status === "OK") return { ok: true };
    if (r.status === "RE" && !r.spawnError && (r.exitCode === 1 || r.exitCode === 2)) {
      return { ok: false, message: said ? `Checker: ${firstLines(said)}` : "The checker rejected the output." };
    }
    const name = path.basename(this.file);
    const why = r.spawnError
      ? `could not be started (${r.spawnError})`
      : r.status === "TLE"
        ? `took longer than ${CHECKER_TIMEOUT_MS / 1000} s`
        : r.status === "OLE"
          ? "printed too much output"
          : `failed (${describeExit(r.exitCode, r.signal)})`;
    throw new CheckerError(`The problem's checker (${name}) ${why} on case ${caseName}. This is a bug in the problem, not your solution.${said ? `\n${firstLines(said)}` : ""}`);
  }

  async dispose() {
    await fs.rm(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

function firstLines(s: string, n = 5): string {
  const lines = s.split(/\r?\n/);
  return lines.length > n ? [...lines.slice(0, n), "…"].join("\n") : s;
}

/** Starting point for a checker (npm run new <slug> -- --checker). */
export const CHECKER_TEMPLATE = String.raw`// Checker: decides whether an output is right, for problems that accept more than one answer.
// Run as   checker <input file> <output file> <answer file>   (answer = the reference's .out).
// Exit 0 = accepted, 1 = wrong answer (print why). Any other exit means the checker is broken.
#include <bits/stdc++.h>
using namespace std;

[[noreturn]] void wrong(const string& why) {
    cout << why << "\n";
    exit(1);
}

int main(int argc, char** argv) {
    if (argc < 4) {
        cerr << "usage: checker <input> <output> <answer>\n";
        return 3;
    }
    ifstream in(argv[1]), out(argv[2]), ans(argv[3]);

    // TODO: read the input from in, the solution's output from out (it can be anything: check
    // every read) and the reference answer from ans; call wrong("...") if the output isn't valid.
    // As a start this accepts exactly the reference's tokens.
    string want, got;
    for (int i = 1; ans >> want; i++) {
        if (!(out >> got)) wrong("output ends early: expected " + want + " as token " + to_string(i));
        if (got != want) wrong("token " + to_string(i) + ": expected " + want + ", got " + got);
    }
    if (out >> got) wrong("extra output: " + got);
    return 0;
}
`;
