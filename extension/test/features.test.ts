// Phase 6: compile cache, time factors, warnings, runtime error locations, user tests kept on update,
// stress test, run history.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import * as path from "path";
import { parseRuntimeError } from "../src/diagnostics";
import { ProgramCache } from "../src/judge/cache";
import { judge, runOnInput, timeLimitFor } from "../src/judge/judge";
import { findStressHelpers, HELPER_TEMPLATES, isStressHelper, saveStressCase, stressTest } from "../src/judge/stress";
import { HistoryStore, MAX_RUNS, RunRecord, summariseRun } from "../src/problems/history";
import { installProblem } from "../src/problems/install";
import { LocalSource } from "../src/problems/source";
import { HAS_GPP, HAS_PY, makeProblem, memento } from "./helpers";

// ---- time factors ----

test("time limit: meta x language factor, Java gets 2x by default", () => {
  assert.equal(timeLimitFor("a/solution.cpp", { timeLimit: 1 }), 1000);
  assert.equal(timeLimitFor("a/Main.java", { timeLimit: 1 }), 2000);
  assert.equal(timeLimitFor("a/solution.py", {}), 2000);
  assert.equal(timeLimitFor("a/Main.java", { timeLimit: 1, timeMultipliers: { java: 3 } }), 3000);
  assert.equal(timeLimitFor("a/solution.py", { timeLimit: 1, timeMultipliers: { python: 2 } }, { timeMultipliers: { python: 5 } }), 5000);
  assert.equal(timeLimitFor("a/Main.java", { timeLimit: 1 }, { timeLimitMs: 300 }), 600, "explicit base still gets the factor");
  assert.equal(timeLimitFor("a/Main.java", { timeLimit: 1, timeMultipliers: { java: -1 } }), 2000, "bad factor ignored");
});

test("judge reports the effective limit", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ "meta.json": '{"timeLimit": 1, "timeMultipliers": {"python": 1.5}}', ".data/1.in": "", ".data/1.out": "x\n", "solution.py": "print('x')\n" });
  const r = await judge(path.join(dir, "solution.py"));
  assert.equal(r.timeLimitMs, 1500);
  assert.equal(r.passed, 1);
});

// ---- compile cache + warnings ----

const CPP_WARN = `#include <cstdio>
int main(){ int unused; printf("7\\n"); }`;

test("cache: compiles once per text, again after a change, warnings kept", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ ".data/1.in": "", ".data/1.out": "7\n", "solution.cpp": CPP_WARN });
  const file = path.join(dir, "solution.cpp");
  const cache = new ProgramCache();
  try {
    const a = await cache.get(file);
    assert.ok(a.ok && !a.cached);
    assert.match(a.ok ? a.warnings : "", /unused/);
    const b = await cache.get(file);
    assert.ok(b.ok && b.cached, "second get is cached");
    assert.match(b.ok ? b.warnings : "", /unused/, "cached result keeps the warnings");

    const r = await judge(file, { cache });
    assert.equal(r.passed, 1);
    assert.match(r.compileWarnings ?? "", /unused/);
    const c = await runOnInput(file, "", { cache });
    assert.ok(!("compileError" in c) && c.output.trim() === "7");

    writeFileSync(file, CPP_WARN.replace("7", "8"));
    const d = await cache.get(file);
    assert.ok(d.ok && !d.cached, "changed text recompiles");

    writeFileSync(file, "int main( {");
    assert.ok(!(await cache.get(file)).ok);
    const e = await cache.get(file);
    assert.ok(!e.ok && !("cached" in e && e.cached), "failed compiles are not cached");
  } finally {
    await cache.clear();
  }
});

test("cache evicts the oldest entries", { skip: !HAS_PY && "python not installed" }, async () => {
  const cache = new ProgramCache(2);
  const files = [1, 2, 3].map((i) => path.join(makeProblem({ "solution.py": `print(${i})\n` }), "solution.py"));
  for (const f of files) await cache.get(f);
  assert.ok(!(await cache.get(files[0])).cached, "first one was evicted");
  assert.ok((await cache.get(files[2])).cached);
  await cache.clear();
});

// ---- runtime error locations ----

test("parseRuntimeError: Python traceback -> innermost frame in the solution", () => {
  const src = "D:\\p\\solution.py";
  const stderr = [
    "Traceback (most recent call last):",
    `  File "${src}", line 9, in <module>`,
    "    main()",
    `  File "${src}", line 5, in main`,
    "    print(1 // 0)",
    "          ~~^~~",
    "ZeroDivisionError: integer division or modulo by zero",
  ].join("\r\n");
  assert.deepEqual(parseRuntimeError(stderr, src), {
    file: src,
    line: 5,
    column: 1,
    severity: "error",
    message: "ZeroDivisionError: integer division or modulo by zero",
  });
  assert.equal(parseRuntimeError(`  File "C:\\lib\\x.py", line 3, in f\nValueError`, src), undefined, "no frame in the solution");
});

test("parseRuntimeError: Java stack trace -> first Main.java frame", () => {
  const stderr = [
    'Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 5',
    "\tat Main.solve(Main.java:12)",
    "\tat Main.main(Main.java:20)",
  ].join("\n");
  assert.deepEqual(parseRuntimeError(stderr, "/p/Main.java"), {
    file: "/p/Main.java",
    line: 12,
    column: 1,
    severity: "error",
    message: "java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 5",
  });
  assert.equal(parseRuntimeError("Segmentation fault", "/p/solution.cpp"), undefined);
});

test("a real Python crash points at its line", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ".data/1.in": "0\n", ".data/1.out": "x\n", "solution.py": "n = int(input())\n\nprint(10 // n)\n" });
  const file = path.join(dir, "solution.py");
  const r = await judge(file);
  assert.equal(r.cases[0].verdict, "RE");
  const m = parseRuntimeError(r.cases[0].stderr, file);
  assert.equal(m?.line, 3);
  assert.match(m!.message, /ZeroDivisionError/);
});

// ---- user tests survive an update ----

const repoFiles = {
  "problems/p/problem.md": "# P\n",
  "problems/p/meta.json": JSON.stringify({ title: "P", difficulty: "easy" }),
  "problems/p/.data/01.in": "1\n",
  "problems/p/.data/01.out": "1\n",
  "problems/p/.data/02.in": "2\n",
  "problems/p/.data/02.out": "2\n",
};

test("updating keeps tests the user added and drops tests the repo removed", async () => {
  const repo = makeProblem(repoFiles);
  const source = new LocalSource(repo);
  const dest = makeProblem({});
  const entry = async () => (await source.loadIndex()).problems.find((p) => p.slug === "p")!;
  await installProblem(source, await entry(), dest);
  const data = path.join(dest, "p", ".data");
  writeFileSync(path.join(data, "my-1.in"), "9\n");
  writeFileSync(path.join(data, "my-1.out"), "9\n");
  await saveStressCase(path.join(dest, "p"), "stress-4", "4\n", "4");

  rmSync(path.join(repo, "problems/p/.data/02.in"));
  rmSync(path.join(repo, "problems/p/.data/02.out"));
  writeFileSync(path.join(repo, "problems/p/.data/01.out"), "one\n");
  await installProblem(source, await entry(), dest);

  assert.equal(readFileSync(path.join(data, "my-1.in"), "utf8"), "9\n");
  assert.equal(readFileSync(path.join(data, "stress-4.out"), "utf8"), "4\n");
  assert.equal(readFileSync(path.join(data, "01.out"), "utf8"), "one\n");
  assert.ok(!existsSync(path.join(data, "02.in")), "a test the repo removed is not kept");
});

test("an old download without a file list: files the new download doesn't have are kept", async () => {
  const repo = makeProblem(repoFiles);
  const source = new LocalSource(repo);
  const dest = makeProblem({});
  const e = (await source.loadIndex()).problems.find((p) => p.slug === "p")!;
  await installProblem(source, e, dest);
  const info = path.join(dest, "p", ".data", ".source.json");
  const { files: _, ...old } = JSON.parse(readFileSync(info, "utf8"));
  writeFileSync(info, JSON.stringify(old));
  writeFileSync(path.join(dest, "p", ".data", "mine.in"), "5\n");
  await installProblem(source, e, dest);
  assert.ok(existsSync(path.join(dest, "p", ".data", "mine.in")));
});

// ---- stress test ----

const SUM_GEN = `import random, sys
random.seed(int(sys.argv[1]))
n = random.randint(1, 5)
print(n)
print(*(random.randint(-5, 5) for _ in range(n)))
`;
const SUM_BRUTE = "input()\nprint(sum(map(int, input().split())))\n";

test("stress: helpers are found and excluded from solutions", async () => {
  const dir = makeProblem({ "gen.py": "", "Brute.java": "" });
  const h = await findStressHelpers(dir);
  assert.equal(path.basename(h.gen!), "gen.py");
  assert.equal(path.basename(h.brute!), "Brute.java");
  assert.ok(isStressHelper("x/gen.cpp") && isStressHelper("x/Brute.java") && !isStressHelper("x/solution.py"));
  await assert.rejects(findStressHelpers(makeProblem({ "gen.py": "", "gen.cpp": "" })), /several gen/);
  assert.deepEqual(await stressTest(path.join(makeProblem({ "solution.py": "" }), "solution.py")), { kind: "missingHelpers", missing: ["gen", "brute"] });
});

test("stress: a correct solution passes, a wrong one is caught with its seed", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ "gen.py": SUM_GEN, "brute.py": SUM_BRUTE, "solution.py": SUM_BRUTE });
  const file = path.join(dir, "solution.py");
  const seen: number[] = [];
  const ok = await stressTest(file, { runs: 5, onProgress: (s) => seen.push(s) });
  assert.deepEqual(ok, { kind: "passed", runs: 5 });
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);

  // wrong when the sum is negative
  writeFileSync(file, "input()\nprint(abs(sum(map(int, input().split()))))\n");
  const bad = await stressTest(file, { runs: 200 });
  assert.equal(bad.kind, "found");
  if (bad.kind !== "found") return;
  assert.equal(bad.result.verdict, "WA");
  assert.equal(bad.result.name, `stress-${bad.seed}`);
  assert.ok(Number(bad.result.expected) < 0);

  const stopped = await stressTest(file, { runs: 3, signal: AbortSignal.abort() });
  assert.equal(stopped.kind, "cancelled");
});

test("stress: a crashing generator is reported as the helper's fault", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ "gen.py": "import sys\nif sys.argv[1] == '3': raise SystemExit(4)\nprint(1)\nprint(1)\n", "brute.py": SUM_BRUTE, "solution.py": SUM_BRUTE });
  const r = await stressTest(path.join(dir, "solution.py"), { runs: 10 });
  assert.equal(r.kind, "helperFailed");
  if (r.kind === "helperFailed") {
    assert.equal(r.seed, 3);
    assert.equal(path.basename(r.file), "gen.py");
  }
});

test("stress: the helper templates run", { skip: !(HAS_PY && HAS_GPP) && "python or g++ not installed" }, async () => {
  // the C++ gen template must compile and print a valid input; brute templates compile
  const dir = makeProblem({ "gen.cpp": HELPER_TEMPLATES.gen.cpp, "brute.py": SUM_BRUTE, "solution.py": SUM_BRUTE });
  assert.deepEqual(await stressTest(path.join(dir, "solution.py"), { runs: 3 }), { kind: "passed", runs: 3 });
  const py = makeProblem({ "gen.py": HELPER_TEMPLATES.gen.python, "brute.cpp": HELPER_TEMPLATES.brute.cpp, "solution.py": "" });
  const r = await stressTest(path.join(py, "solution.py"), { runs: 1 });
  assert.equal(r.kind, "passed", "empty brute and empty solution agree (both print nothing)");
});

// ---- run history ----

const rec = (over: Partial<RunRecord>): RunRecord => ({ at: "2026-11-22T10:00:00Z", language: "cpp", verdict: "AC", passed: 3, total: 3, maxTimeMs: 50, ...over });

test("summariseRun", () => {
  const c = (verdict: "AC" | "WA" | "TLE" | "NO_EXPECTED", timeMs = 10) => ({ name: "x", verdict, timeMs, input: "", expected: null, output: "", stderr: "" });
  assert.deepEqual(summariseRun([c("AC", 5), c("AC", 30)], 2, false), { verdict: "AC", passed: 2, total: 2, maxTimeMs: 30 });
  assert.deepEqual(summariseRun([c("AC"), c("TLE", 2000), c("WA")], 3, false), { verdict: "TLE", passed: 1, total: 3, maxTimeMs: 2000 });
  assert.deepEqual(summariseRun([], 4, true), { verdict: "CE", passed: 0, total: 4, maxTimeMs: 0 });
  assert.equal(summariseRun([c("NO_EXPECTED")], 1, false), undefined, "nothing to judge");
  assert.equal(summariseRun([c("AC")], 3, false), undefined, "incomplete run");
});

test("HistoryStore: newest first, capped, best AC prefers current tests", async () => {
  const h = new HistoryStore(memento());
  let fired = 0;
  h.onDidChange(() => fired++);
  await h.add("r", "p", rec({ maxTimeMs: 40, hash: "old" }));
  await h.add("r", "p", rec({ verdict: "WA", passed: 1, maxTimeMs: 5, hash: "new" }));
  await h.add("r", "p", rec({ maxTimeMs: 90, hash: "new", language: "python" }));
  assert.equal(fired, 3);
  assert.deepEqual(h.runs("r", "p").map((r) => r.maxTimeMs), [90, 5, 40]);
  assert.equal(h.best("r", "p", "new")?.maxTimeMs, 90, "the fastest AC on the current tests");
  assert.equal(h.best("r", "p", "other")?.maxTimeMs, 40, "no AC on these tests: fastest of all");
  assert.equal(h.best("r", "q"), undefined);
  for (let i = 0; i < MAX_RUNS + 5; i++) await h.add("r", "p", rec({}));
  assert.equal(h.runs("r", "p").length, MAX_RUNS);
});

test("JsonFileStore persists across instances", async () => {
  const { JsonFileStore } = await import("../src/problems/history");
  const file = path.join(makeProblem({}), "sub", "history.json");
  const a = new JsonFileStore(file);
  assert.equal(a.get("k", 1), 1);
  void a.update("k", { x: [1] });
  await a.update("j", 2);
  const b = new JsonFileStore(file);
  assert.deepEqual(b.get("k", null), { x: [1] });
  assert.equal(b.get("j", 0), 2);
});
