// Phase 7: memory limit (memwatch helper, MLE), custom checkers, hints in the index.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "fs";
import * as path from "path";
import { CHECKER_TEMPLATE, CheckerError, findChecker } from "../src/judge/checker";
import { judge, memoryLimitFor, runOnInput } from "../src/judge/judge";
import { commandFor, getMemwatch, quoteWindowsArg } from "../src/judge/memory";
import { stressTest } from "../src/judge/stress";
import { HintStore, parseHints } from "../src/problems/hints";
import { buildIndex, parseIndex } from "../src/problems/indexFile";
import { HAS_GPP, HAS_JAVA, HAS_PY, makeProblem, memento } from "./helpers";

const MB = 1024 * 1024;

// ---- pure helpers ----

test("Windows argument quoting follows the CommandLineToArgvW rules", () => {
  assert.equal(quoteWindowsArg("plain"), "plain");
  assert.equal(quoteWindowsArg(""), '""');
  assert.equal(quoteWindowsArg("C:\\Program Files\\x.exe"), '"C:\\Program Files\\x.exe"');
  assert.equal(quoteWindowsArg('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteWindowsArg("dir with space\\"), '"dir with space\\\\"', "trailing backslashes are doubled before the closing quote");
});

test("Java gets a small start heap, the serial GC and -Xmx under a limit", () => {
  const java = { language: "java" as const, command: ["java", "-Xss256m", "-cp", "d", "Main"] };
  assert.deepEqual(commandFor(java), ["java", "-Xms16m", "-XX:+UseSerialGC", "-Xss256m", "-cp", "d", "Main"]);
  assert.deepEqual(commandFor(java, 64), ["java", "-Xms16m", "-XX:+UseSerialGC", "-Xmx64m", "-Xss256m", "-cp", "d", "Main"]);
  const cpp = { language: "cpp" as const, command: ["a.exe"] };
  assert.deepEqual(commandFor(cpp, 64), ["a.exe"]);
});

test("memory limit comes from meta.json, an override wins, nonsense is ignored", () => {
  assert.equal(memoryLimitFor({ memoryLimit: 256 }), 256);
  assert.equal(memoryLimitFor({ memoryLimit: 256 }, 64), 64);
  assert.equal(memoryLimitFor({}), undefined);
  assert.equal(memoryLimitFor({ memoryLimit: -1 }), undefined);
  assert.equal(memoryLimitFor({ memoryLimit: 256 }, 0), undefined, "0 turns the limit off");
});

// ---- memory, measured ----

const CPP_HOG = `#include <bits/stdc++.h>
int main(){ int mb; std::cin >> mb; std::vector<char> v((size_t)mb << 20, 1); long long s = 0;
  for (size_t i = 0; i < v.size(); i += 4096) s += v[i]; std::cout << s / 256 << "\\n"; }`;

test("C++: peak memory is measured, and going over the limit is MLE", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  assert.ok(await getMemwatch(), "the helper builds with g++");
  const dir = makeProblem({
    "meta.json": '{"memoryLimit": 64}',
    ".data/1.in": "8\n",
    ".data/1.out": "8\n",
    ".data/2.in": "200\n",
    ".data/2.out": "200\n",
    "solution.cpp": CPP_HOG,
  });
  const r = await judge(path.join(dir, "solution.cpp"));
  assert.equal(r.memoryLimitMb, 64);
  assert.equal(r.memoryMeasured, true);
  const [small, big] = r.cases;
  assert.equal(small.verdict, "AC");
  assert.ok(small.memoryBytes! > 8 * MB && small.memoryBytes! < 40 * MB, `8 MB vector measured as ${small.memoryBytes}`);
  assert.equal(big.verdict, "MLE", big.message);
  assert.match(big.message ?? "", /64 MB/);

  const free = await judge(path.join(dir, "solution.cpp"), { memoryLimitMb: 0 });
  assert.equal(free.cases[1].verdict, "AC", "no limit: the 200 MB case passes");
  assert.ok(free.cases[1].memoryBytes! > 200 * MB);
});

test("Python: MLE over the limit, and custom input reports memory", { skip: !(HAS_PY && HAS_GPP) && "needs python and g++" }, async () => {
  const dir = makeProblem({
    "meta.json": '{"memoryLimit": 32}',
    ".data/1.in": "100\n",
    ".data/1.out": "100\n",
    "solution.py": "n = int(input())\nx = bytearray(n * 1024 * 1024)\nprint(len(x) >> 20)\n",
  });
  const r = await judge(path.join(dir, "solution.py"));
  assert.equal(r.cases[0].verdict, "MLE");
  const c = await runOnInput(path.join(dir, "solution.py"), "40\n");
  assert.ok(!("compileError" in c));
  assert.equal(c.verdict, "NO_EXPECTED", "custom input has no limit");
  assert.ok(c.memoryBytes! > 40 * MB, `measured ${c.memoryBytes}`);
});

test("Java: running out of the -Xmx heap is MLE", { skip: !(HAS_JAVA && HAS_GPP) && "needs a JDK and g++" }, async () => {
  const dir = makeProblem({
    "meta.json": '{"memoryLimit": 32}',
    ".data/1.in": "",
    ".data/1.out": "1\n",
    "Main.java": "public class Main { public static void main(String[] a) { long[] x = new long[16 * 1024 * 1024]; System.out.println(x.length > 0 ? 1 : 0); } }\n",
  });
  const r = await judge(path.join(dir, "Main.java"));
  assert.equal(r.cases[0].verdict, "MLE", r.cases[0].stderr);
});

test("without memwatch nothing is measured and the limit is reported as not checked", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ "meta.json": '{"memoryLimit": 16}', ".data/1.in": "", ".data/1.out": "1\n", "solution.py": "print(1)\n" });
  const r = await judge(path.join(dir, "solution.py"), { measureMemory: false });
  assert.equal(r.memoryMeasured, false);
  assert.equal(r.cases[0].verdict, "AC");
  assert.equal(r.cases[0].memoryBytes, undefined);
});

// ---- checkers ----

const PAIR_CHECKER = `import sys
inp = open(sys.argv[1]).read().split()
out = open(sys.argv[2]).read().split()
ans = open(sys.argv[3]).read().split()
n, t = int(inp[0]), int(inp[1])
a = list(map(int, inp[2:2 + n]))
if ans == ["-1"]:
    sys.exit(0 if out == ["-1"] else 1)
if len(out) != 2:
    print("expected two positions")
    sys.exit(1)
i, j = map(int, out)
if not (1 <= i < j <= n) or a[i - 1] + a[j - 1] != t:
    print(f"{i} {j} is not a valid pair")
    sys.exit(1)
`;

// prints the LAST valid pair; the .out files hold the first one
const ANY_PAIR = `n, t = map(int, input().split())
a = list(map(int, input().split()))
best = None
for i in range(n):
    for j in range(i + 1, n):
        if a[i] + a[j] == t:
            best = (i + 1, j + 1)
print(*best if best else [-1])
`;

function pairProblem(extra: Record<string, string> = {}) {
  return makeProblem({
    ".data/1.in": "4 10\n1 6 4 9\n",
    ".data/1.out": "1 4\n",
    ".data/2.in": "3 10\n5 1 2\n",
    ".data/2.out": "-1\n",
    ".data/checker.py": PAIR_CHECKER,
    "solution.py": ANY_PAIR,
    ...extra,
  });
}

test("a checker accepts another right answer and explains a wrong one", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = pairProblem();
  assert.equal(path.basename((await findChecker(dir))!), "checker.py");
  const ok = await judge(path.join(dir, "solution.py"));
  assert.equal(ok.checker, "checker.py");
  assert.deepEqual(ok.cases.map((c) => c.verdict), ["AC", "AC"], "2 3 is right even though the .out says 1 4");

  const bad = pairProblem({ "solution.py": "input(); input(); print(1, 2)\n" });
  const r = await judge(path.join(bad, "solution.py"));
  assert.equal(r.cases[0].verdict, "WA");
  assert.match(r.cases[0].message ?? "", /Checker: 1 2 is not a valid pair/);
  assert.equal(r.cases[0].diff, undefined);
});

test("a broken checker stops the run with an error that blames the problem", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = pairProblem({ ".data/checker.py": "import sys\nsys.exit(7)\n" });
  await assert.rejects(judge(path.join(dir, "solution.py")), (e: Error) => e instanceof CheckerError && /checker \(checker\.py\) failed .* case 1/.test(e.message));
  const two = pairProblem({ ".data/checker.cpp": "int main(){}" });
  await assert.rejects(judge(path.join(two, "solution.py")), /several checkers/);
});

test("the C++ checker template compiles and compares tokens", { skip: !(HAS_GPP && HAS_PY) && "needs g++ and python" }, async () => {
  const dir = makeProblem({
    ".data/1.in": "",
    ".data/1.out": "1 2 3\n",
    ".data/2.in": "",
    ".data/2.out": "1 2 4\n",
    ".data/checker.cpp": CHECKER_TEMPLATE,
    "solution.py": "print(1, 2,\n 3)\n",
  });
  const r = await judge(path.join(dir, "solution.py"));
  assert.equal(r.cases[0].verdict, "AC");
  assert.equal(r.cases[1].verdict, "WA");
  assert.match(r.cases[1].message ?? "", /token 3: expected 4, got 3/);
});

test("the stress test judges through the checker", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = pairProblem({
    "gen.py": "import random, sys\nrandom.seed(int(sys.argv[1]))\nn = random.randint(2, 6)\nprint(n, random.randint(-4, 4))\nprint(*[random.randint(-3, 3) for _ in range(n)])\n",
    // brute prints the FIRST pair, the solution the last: different text, both right
    "brute.py": "n, t = map(int, input().split())\na = list(map(int, input().split()))\nfor j in range(n):\n    for i in range(j):\n        if a[i] + a[j] == t:\n            print(i + 1, j + 1)\n            raise SystemExit\nprint(-1)\n",
  });
  const o = await stressTest(path.join(dir, "solution.py"), { runs: 25 });
  assert.equal(o.kind, "passed", JSON.stringify(o).slice(0, 300));
});

// ---- hints ----

test("hints: one per ## heading, code fences and the intro don't count", () => {
  const hints = parseHints("# Hints\nintro text\n\n## First\nLook at sums.\n\n## Second ##\n```\n## not a heading\n```\nUse a map.\n");
  assert.deepEqual(hints, [
    { title: "First", body: "Look at sums." },
    { title: "Second", body: "```\n## not a heading\n```\nUse a map." },
  ]);
  assert.deepEqual(parseHints("no headings at all"), []);
});

test("HintStore remembers how many hints were opened, per repo and problem", async () => {
  const store = new HintStore(memento());
  assert.equal(store.shown("r", "a"), 0);
  await store.setShown("r", "a", 2);
  assert.equal(store.shown("r", "a"), 2);
  assert.equal(store.shown("other", "a"), 0);
  await store.setShown("r", "a", 0);
  assert.equal(store.shown("r", "a"), 0);
});

test("the index counts hints but doesn't ship or hash hints.md", async () => {
  const files = { "problem.md": "# P\n", "meta.json": '{"title": "P"}', ".data/1.in": "1\n", ".data/1.out": "1\n" };
  const root = makeProblem(Object.fromEntries(Object.entries(files).map(([k, v]) => [`problems/p/${k}`, v])));
  const before = (await buildIndex(root)).index.problems[0];
  assert.equal(before.hints, undefined);

  const withHints = makeProblem(
    Object.fromEntries([...Object.entries(files), ["hints.md", "## One\na\n## Two\nb\n"]].map(([k, v]) => [`problems/p/${k}`, v])),
  );
  const after = (await buildIndex(withHints)).index.problems[0];
  assert.equal(after.hints, 2);
  assert.ok(!after.files.includes("hints.md"), "not downloaded");
  assert.equal(after.hash, before.hash, "editing hints doesn't flag the tests as updated");

  const bad = parseIndex(JSON.stringify({ version: 1, problems: [{ slug: "p", title: "P", files: [], hash: "x", hints: "lots" }] }));
  assert.equal(bad.problems[0].hints, undefined, "a nonsense count is dropped");
  assert.ok(readFileSync(path.join(withHints, "problems/p/hints.md"), "utf8").includes("## Two"));
});
