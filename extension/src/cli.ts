#!/usr/bin/env node
/**
 * Command-line front end for the judge engine (the extension uses the same engine).
 *
 *   node out/src/cli.js problems/two-sum/solution.cpp
 *   node out/src/cli.js problems/two-sum/Main.java --case 03 --timeout 5
 */
import { CaseResult, judge, Verdict } from "./judge";

const color = process.stdout.isTTY || !!process.env.FORCE_COLOR;
const c = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = c("32"), red = c("31"), yellow = c("33"), cyan = c("36"), dim = c("2"), bold = c("1");

const LABEL: Record<Verdict, string> = {
  AC: green("✓ PASS"),
  WA: red("✗ WA  "),
  TLE: red("✗ TLE "),
  MLE: red("✗ MLE "),
  RE: red("✗ RE  "),
  OLE: red("✗ OLE "),
  NO_EXPECTED: cyan("• RAN "),
};

function clip(s: string, maxLines = 15, maxChars = 1500): string {
  let ls = s.replace(/\s+$/, "").split(/\r?\n/);
  let more = "";
  if (ls.length > maxLines) {
    more = `\n... (${ls.length - maxLines} more lines)`;
    ls = ls.slice(0, maxLines);
  }
  let t = ls.join("\n");
  if (t.length > maxChars) [t, more] = [t.slice(0, maxChars), "\n... (truncated)"];
  return (t || "<empty>") + more;
}

const indent = (s: string) => s.split("\n").map((l) => "        " + l).join("\n");

function usage(): never {
  console.error("usage: cli.js <solution file> [--case NAME ...] [--timeout SECONDS] [--exact] [--ignore-case] [--eps X] [--quiet]");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  let solution: string | undefined;
  const only: string[] = [];
  let timeLimitMs: number | undefined;
  const compare: { exact?: boolean; ignoreCase?: boolean; eps?: number } = {};
  let quiet = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--case" || a === "-c") {
      while (args[i + 1] && !args[i + 1].startsWith("-")) only.push(args[++i]);
    } else if (a === "--timeout") timeLimitMs = Number(args[++i]) * 1000;
    else if (a === "--exact") compare.exact = true;
    else if (a === "--ignore-case" || a === "-i") compare.ignoreCase = true;
    else if (a === "--eps") compare.eps = Number(args[++i]);
    else if (a === "--quiet" || a === "-q") quiet = true;
    else if (a.startsWith("-")) usage();
    else solution = a;
  }
  if (!solution) usage();

  console.log(bold(`▶ ${solution}`));
  const show = (r: CaseResult) => {
    const ms = dim(`${Math.round(r.timeMs).toString().padStart(6)} ms`);
    const mem = r.memoryBytes !== undefined ? dim(`${(r.memoryBytes / 1048576).toFixed(1).padStart(7)} MB`) : "";
    console.log(`  ${LABEL[r.verdict]} case ${r.name.padEnd(4)} ${ms}${mem}${r.message ? "  " + yellow(r.message) : ""}`);
    if (r.verdict !== "AC") {
      console.log(dim("    input:\n") + indent(clip(r.input)));
      if (r.verdict === "WA") {
        console.log(green("    expected:\n") + indent(clip(r.expected ?? "")));
        console.log(red("    yours:\n") + indent(clip(r.output)));
        if (r.diff) console.log(yellow(`    first difference at line ${r.diff.line}: expected ${JSON.stringify(r.diff.expected)}, got ${JSON.stringify(r.diff.got)}`));
      } else if (r.verdict === "NO_EXPECTED") {
        console.log(cyan("    your output:\n") + indent(clip(r.output)));
      } else if (r.verdict === "RE" && r.stderr.trim()) {
        console.log(red("    stderr:\n") + indent(clip(r.stderr, 20)));
      }
    }
    if (!quiet && r.verdict !== "RE" && r.stderr.trim()) console.log(dim("    stderr (debug):\n" + indent(clip(r.stderr, 8))));
  };

  const report = await judge(solution, { only, timeLimitMs, compare, onCase: show });
  if (report.compileError) {
    console.log(red("✗ COMPILE ERROR\n") + indent(report.compileError));
    process.exit(1);
  }
  const slowest = Math.max(0, ...report.cases.map((r) => r.timeMs));
  const peak = Math.max(0, ...report.cases.map((r) => r.memoryBytes ?? 0));
  const limits =
    dim(`   slowest ${Math.round(slowest)} ms`) +
    (peak ? dim(`, peak ${(peak / 1048576).toFixed(1)} MB${report.memoryLimitMb ? ` of ${report.memoryLimitMb} MB` : ""}`) : "") +
    (report.memoryLimitMb && !report.memoryMeasured ? yellow("   (memory limit not checked: needs g++)") : "");
  const failed = report.cases.filter((r) => r.verdict !== "AC" && r.verdict !== "NO_EXPECTED").length;
  console.log();
  if (report.total === 0) console.log(yellow("No test cases found."));
  else if (failed === 0) console.log(green(bold(`ALL PASSED  ${report.passed}/${report.total}`)) + limits);
  else console.log(red(bold(`FAILED  ${report.passed}/${report.total} passed`)) + limits);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(red(String(e instanceof Error ? e.message : e)));
  process.exit(2);
});
