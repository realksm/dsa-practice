import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "path";
import { judge, runOnInput } from "../src/judge/judge";
import { HAS_GPP, HAS_JAVA, HAS_PY, makeProblem } from "./helpers";

// A tiny problem: read n numbers, print their sum.
const DATA = {
  ".data/1.in": "3\n1 2 3\n",
  ".data/1.out": "6\n",
  ".data/2.in": "1\n-5\n",
  ".data/2.out": "-5\n",
  ".data/3.in": "2\n1000000000000 1000000000000\n",
  ".data/3.out": "2000000000000\n",
};

const CPP_OK = `#include <bits/stdc++.h>
int main(){ int n; std::cin>>n; long long s=0,x; while(n--){std::cin>>x; s+=x;} std::cout<<s<<"\\n"; }`;
const JAVA_OK = `import java.util.*;
public class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); long s=0; while(n-->0) s+=sc.nextLong(); System.out.println(s); } }`;
const PY_OK = `n = int(input())\nprint(sum(map(int, input().split())))\n`;

const verdicts = (r: Awaited<ReturnType<typeof judge>>) => r.cases.map((c) => c.verdict);

test("C++: all pass", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.cpp": CPP_OK });
  const r = await judge(path.join(dir, "solution.cpp"));
  assert.equal(r.compileError, undefined);
  assert.deepEqual(verdicts(r), ["AC", "AC", "AC"]);
  assert.equal(r.passed, 3);
});

test("Java: all pass", { skip: !HAS_JAVA && "JDK not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "Main.java": JAVA_OK });
  const r = await judge(path.join(dir, "Main.java"), { timeLimitMs: 5000 });
  assert.equal(r.compileError, undefined);
  assert.deepEqual(verdicts(r), ["AC", "AC", "AC"]);
});

test("Python: all pass", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.py": PY_OK });
  const r = await judge(path.join(dir, "solution.py"));
  assert.deepEqual(verdicts(r), ["AC", "AC", "AC"]);
});

test("C++: wrong answer reports the difference", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  // int overflows on case 3
  const dir = makeProblem({ ...DATA, "solution.cpp": CPP_OK.replace("long long s=0,x", "int s=0,x") });
  const r = await judge(path.join(dir, "solution.cpp"));
  assert.deepEqual(verdicts(r), ["AC", "AC", "WA"]);
  assert.equal(r.cases[2].diff?.line, 1);
  assert.equal(r.cases[2].diff?.expected, "2000000000000");
});

test("C++: compile error", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.cpp": "int main( { }" });
  const r = await judge(path.join(dir, "solution.cpp"));
  assert.ok(r.compileError && r.compileError.length > 0);
  assert.equal(r.cases.length, 0);
  assert.equal(r.total, 3);
});

test("C++: infinite loop is TLE and gets killed", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.cpp": "int main(){ volatile int x=0; while(true) x++; }" });
  const t0 = Date.now();
  const r = await judge(path.join(dir, "solution.cpp"), { timeLimitMs: 300, only: ["1"] });
  assert.deepEqual(verdicts(r), ["TLE"]);
  assert.ok(Date.now() - t0 < 30_000);
});

test("C++: crash is RE with a reason", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.cpp": "#include <cstdlib>\nint main(){ std::exit(3); }" });
  const r = await judge(path.join(dir, "solution.cpp"), { only: ["1"] });
  assert.deepEqual(verdicts(r), ["RE"]);
  assert.equal(r.cases[0].message, "exit code 3");
});

test("C++: deep recursion works (256 MB stack)", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  // ~80 MB of stack: crashes with the default stack (1 MB Windows, 8 MB Linux), so this tests the
  // linker flag on Windows and memwatch's setrlimit elsewhere.
  const src = `#include <cstdio>
int f(int n, char* up){ char buf[256]; buf[n & 255] = up[0]; if (n == 0) return buf[0]; int r = f(n - 1, buf); return r + buf[(n * 7) & 255]; }
int main(){ char z[1] = {0}; int n; std::scanf("%d", &n); std::printf("%d\\n", f(n, z) * 0); }`;
  const dir = makeProblem({ ".data/1.in": "300000\n", ".data/1.out": "0\n", "solution.cpp": src });
  const r = await judge(path.join(dir, "solution.cpp"));
  assert.deepEqual(verdicts(r), ["AC"], r.cases[0]?.message);
});

test("Python: exception is RE and shows the traceback", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.py": "print(1 // 0)\n" });
  const r = await judge(path.join(dir, "solution.py"), { only: ["1"] });
  assert.deepEqual(verdicts(r), ["RE"]);
  assert.match(r.cases[0].stderr, /ZeroDivisionError/);
});

test("Python: infinite loop is TLE", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.py": "while True: pass\n" });
  const r = await judge(path.join(dir, "solution.py"), { timeLimitMs: 500, only: ["1"] });
  assert.deepEqual(verdicts(r), ["TLE"]);
});

test("Python: unicode output survives", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ".data/1.in": "\n", ".data/1.out": "héllo ✓\n", "solution.py": "print('héllo ✓')\n" });
  const r = await judge(path.join(dir, "solution.py"));
  assert.deepEqual(verdicts(r), ["AC"], r.cases[0]?.output);
});

test("stderr is captured but doesn't affect the verdict", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.py": "import sys\nprint('debug', file=sys.stderr)\n" + PY_OK });
  const r = await judge(path.join(dir, "solution.py"), { only: ["1"] });
  assert.deepEqual(verdicts(r), ["AC"]);
  assert.match(r.cases[0].stderr, /debug/);
});

test("meta.json time limit is used", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "meta.json": '{"timeLimit": 0.4}', "solution.py": "while True: pass\n" });
  const r = await judge(path.join(dir, "solution.py"), { only: ["1"] });
  assert.equal(r.timeLimitMs, 400);
  assert.deepEqual(verdicts(r), ["TLE"]);
});

test("cases without an answer are NO_EXPECTED", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ".data/1.in": "2\n3 4\n", "solution.py": PY_OK });
  const r = await judge(path.join(dir, "solution.py"));
  assert.deepEqual(verdicts(r), ["NO_EXPECTED"]);
  assert.equal(r.cases[0].output.trim(), "7");
});

test("runOnInput runs custom input", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ "solution.py": PY_OK });
  const r = await runOnInput(path.join(dir, "solution.py"), "2\n10 20\n");
  assert.ok(!("compileError" in r));
  if (!("compileError" in r)) assert.equal(r.output.trim(), "30");
});

test("missing compiler gives an install hint", async () => {
  const dir = makeProblem({ ...DATA, "solution.cpp": CPP_OK });
  const r = await judge(path.join(dir, "solution.cpp"), { tools: { cpp: "definitely-not-a-compiler" } });
  assert.match(r.compileError ?? "", /could not be started.*Install g\+\+/s);
});

test("onCase reports progress and abort stops the run", { skip: !HAS_PY && "python not installed" }, async () => {
  const dir = makeProblem({ ...DATA, "solution.py": "while True: pass\n" });
  const ac = new AbortController();
  const seen: string[] = [];
  setTimeout(() => ac.abort(), 300);
  const r = await judge(path.join(dir, "solution.py"), {
    timeLimitMs: 5000,
    signal: ac.signal,
    onCase: (c) => seen.push(c.name),
  });
  assert.equal(r.cases.length, 0);
  assert.deepEqual(seen, []);
});
