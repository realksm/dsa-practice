// Known gaps closed on 2026-11-24: C++ crashes mapped to a line (Windows, Linux, Mac), local headers
// in the compile cache, memory enforced during the run on Linux/Mac, and the helper's child killed
// with it. Mac: <bits/stdc++.h> for Apple clang.
import { test } from "node:test";
import * as assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import { parseRuntimeError } from "../src/diagnostics";
import { ProgramCache, localHeaders } from "../src/judge/cache";
import { addr2lineFor, getCrashReporter, parseAddr2line, parseAtos, peImageBase, stripTrace } from "../src/judge/crash";
import { judge } from "../src/judge/judge";
import { getMemwatch } from "../src/judge/memory";
import { runProcess } from "../src/judge/runner";
import { STDCPP_SHIM, stdcppArgs } from "../src/judge/stdcpp";
import { HAS_GPP, HAS_PY, makeProblem } from "./helpers";

const REPORTER = ["win32", "linux", "darwin"].includes(process.platform);
const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

// ---- pure helpers ----

test("parseAddr2line: innermost inline first, unknown locations dropped, discriminators ignored", () => {
  const out = [
    "0x0000000140001832",
    "std::vector<int>::operator[](unsigned long long)",
    "C:/mingw/include/c++/bits/stl_vector.h:1130",
    "main",
    "D:/p/solution.cpp:7 (discriminator 2)",
    "0x0000000140002000",
    "??",
    "??:0",
    "0x0000000140003000",
    "f(int)",
    "D:/p/solution.cpp:3",
    "",
  ].join("\n");
  assert.deepEqual(parseAddr2line(out), [
    { func: "std::vector<int>::operator[](unsigned long long)", file: "C:/mingw/include/c++/bits/stl_vector.h", line: 1130 },
    { func: "main", file: "D:/p/solution.cpp", line: 7 },
    { func: "f(int)", file: "D:/p/solution.cpp", line: 3 },
  ]);
});

test("parseAtos: inline frames in order, lines without debug info dropped", () => {
  const out = [
    "std::__1::vector<int, std::__1::allocator<int>>::at[abi:ne180100](unsigned long) (in solution) (vector:1531)",
    "main (in solution) (solution.cpp:9)",
    "",
    "start (in dyld) + 6076",
    "depth(int) (in solution) (solution.cpp:3)",
    "",
  ].join("\n");
  assert.deepEqual(parseAtos(out), [
    { func: "std::__1::vector<int, std::__1::allocator<int>>::at[abi:ne180100](unsigned long)", file: "vector", line: 1531 },
    { func: "main", file: "solution.cpp", line: 9 },
    { func: "depth(int)", file: "solution.cpp", line: 3 },
  ]);
});

test("stripTrace removes every reporter line and keeps the program's own stderr", () => {
  assert.equal(stripTrace("oops\n\n@@dsa-drill-trace pe =1a 2b\n"), "oops\n\n");
  assert.equal(stripTrace("a\n@@dsa-drill-trace pe =1\n\n@@dsa-drill-trace pe =1\n"), "a\n\n");
  assert.equal(stripTrace("plain\n"), "plain\n");
});

test("addr2lineFor: next to the compiler, with its target prefix, then PATH", () => {
  const dir = path.join("C:", "mingw", "bin");
  const list = addr2lineFor(path.join(dir, "x86_64-w64-mingw32-g++"));
  assert.equal(list[0], path.join(dir, `x86_64-w64-mingw32-addr2line${IS_WIN ? ".exe" : ""}`));
  assert.ok(list.includes("addr2line"));
  assert.deepEqual(addr2lineFor("g++"), ["addr2line"]);
});

test("parseRuntimeError: C++ trace, uncaught exception and failed asserts", () => {
  const src = path.join("D:", "p", "solution.cpp");
  const trace = "Crashed at (innermost call first):\n  at depth(int) (solution.cpp:3)  x190\n  at main (solution.cpp:10)\n";
  assert.deepEqual(parseRuntimeError(trace, src, "stack overflow"), { file: src, line: 3, column: 1, severity: "error", message: "stack overflow" });

  const thrown = "terminate called after throwing an instance of 'std::out_of_range'\n  what():  vector::_M_range_check\n\n" + "Crashed at (innermost call first):\n  at main (solution.cpp:9)\n";
  assert.equal(parseRuntimeError(thrown, src)?.line, 9);
  assert.equal(parseRuntimeError(thrown, src)?.message, "std::out_of_range (vector::_M_range_check)");

  assert.deepEqual(parseRuntimeError("Assertion failed: n < 3, file D:\\p\\solution.cpp, line 12\n", src)?.line, 12);
  const glibc = parseRuntimeError("solution: /home/u/p/solution.cpp:14: int main(): Assertion `n < 3' failed.\n", src);
  assert.equal(glibc?.line, 14);
  assert.equal(glibc?.message, "Assertion failed: n < 3");
  assert.equal(parseRuntimeError("Segmentation fault\n", src), undefined);

  // Mac (libc++ and Apple's assert)
  const mac = "libc++abi: terminating due to uncaught exception of type std::out_of_range: vector\n\nCrashed at (innermost call first):\n  at main (solution.cpp:9)\n";
  assert.equal(parseRuntimeError(mac, src)?.message, "std::out_of_range (vector)");
  const appleAssert = parseRuntimeError("Assertion failed: (n < 3), function main, file solution.cpp, line 12.\n", src);
  assert.equal(appleAssert?.line, 12);
  assert.equal(appleAssert?.message, "Assertion failed: n < 3");
});

test("peImageBase reads PE32+ and rejects other files", () => {
  const pe = Buffer.alloc(512);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(0x80, 0x3c);
  pe.writeUInt32LE(0x4550, 0x80);
  pe.writeUInt16LE(0x20b, 0x80 + 24);
  pe.writeBigUInt64LE(0x140000000n, 0x80 + 24 + 24);
  assert.equal(peImageBase(pe), 0x140000000n);
  assert.equal(peImageBase(Buffer.from("\x7fELF not a PE file at all, just some bytes to be long enough............")), undefined);
});

// ---- C++ crashes, for real ----

const CRASHES = `#include <bits/stdc++.h>
using namespace std;
int depth(int n) { volatile char pad[512]; pad[0] = n; return n == 0 ? pad[0] : depth(n - 1) + pad[0]; }
int main() {
    int n; cin >> n;
    vector<int> v(3);
    if (n == 1) { int* volatile p = nullptr; *p = 1; }
    if (n == 2) { volatile int z = n - 2; cout << 10 / z << endl; }
    if (n == 3) cout << v.at(10) << endl;
    if (n == 4) cout << depth(100000000) << endl;
    cout << 0 << endl;
}
`;

test("C++ crashes point at their line: bad pointer, division by zero, uncaught exception, stack overflow", { skip: !(HAS_GPP && REPORTER) && "needs g++ on Windows, Linux or Mac" }, async () => {
  const files: Record<string, string> = { "solution.cpp": CRASHES };
  // Integer division by zero doesn't trap on ARM (it gives 0), so case 2 only runs on x86.
  const cases = process.arch === "arm64" ? [1, 3, 4] : [1, 2, 3, 4];
  for (const n of cases) {
    files[`.data/${n}.in`] = `${n}\n`;
    files[`.data/${n}.out`] = "0\n";
  }
  const dir = makeProblem(files);
  const src = path.join(dir, "solution.cpp");
  assert.ok(await getCrashReporter("g++"), "the reporter builds");
  const r = await judge(src);
  const want: Record<string, number> = { "1": 7, "2": 8, "3": 9, "4": 3 };
  for (const c of r.cases) {
    assert.equal(c.verdict, "RE", `case ${c.name}: ${c.message}`);
    assert.doesNotMatch(c.stderr, /@@dsa-drill-trace/, "the raw trace line is never shown");
    const m = parseRuntimeError(c.stderr, src, c.message);
    assert.equal(m?.line, want[c.name], `case ${c.name}:\n${c.stderr}`);
  }
  // The crash still ends the way it did without the reporter.
  const byName = Object.fromEntries(r.cases.map((c) => [c.name, c.message ?? ""]));
  // A bad access is SIGBUS rather than SIGSEGV on a Mac for some pages (the stack guard).
  const segv = IS_MAC ? /SIG(SEGV|BUS)/ : /SIGSEGV/;
  assert.match(byName["1"], IS_WIN ? /0xC0000005/ : segv);
  if (byName["2"] !== undefined) assert.match(byName["2"], IS_WIN ? /0xC0000094/ : /SIGFPE/);
  assert.match(byName["4"], IS_WIN ? /0xC00000FD/ : segv);
});

test("a correct C++ program is unaffected by the reporter", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ "solution.cpp": CRASHES, ".data/1.in": "0\n", ".data/1.out": "0\n" });
  const r = await judge(path.join(dir, "solution.cpp"));
  assert.equal(r.cases[0].verdict, "AC");
  assert.equal(r.cases[0].stderr, "");
});

// ---- <bits/stdc++.h> for Apple clang ----

test("the bits/stdc++.h shim compiles with this g++, and is only used on a Mac", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({ "bits/stdc++.h": STDCPP_SHIM, "use.cpp": "#include <bits/stdc++.h>\nint main() { std::vector<int> v{3, 1, 2}; std::sort(v.begin(), v.end()); return v[0] - 1; }\n" });
  const r = await runProcess(["g++", "-std=c++17", "-fsyntax-only", "-I", dir, path.join(dir, "use.cpp")], "", { timeoutMs: 60_000 });
  assert.equal(r.status, "OK", r.stderr);
  const args = await stdcppArgs();
  if (IS_MAC) {
    assert.equal(args[0], "-idirafter");
    assert.ok(existsSync(path.join(args[1], "bits", "stdc++.h")));
  } else {
    assert.deepEqual(args, []);
  }
});

// ---- local headers in the compile cache ----

test("localHeaders follows #include \"...\" recursively, ignores <...>, and lists missing ones", async () => {
  const dir = makeProblem({
    "solution.cpp": '#include <vector>\n#include "a.h"\n  #  include "missing.h"\n',
    "a.h": '#pragma once\n#include "sub/b.h"\n',
    "sub/b.h": '#include "../a.h"\nint b();\n',
  });
  const src = path.join(dir, "solution.cpp");
  const found = await localHeaders(src, readFileSync(src, "utf8"));
  assert.deepEqual([...found.keys()].sort(), [path.join(dir, "a.h"), path.join(dir, "missing.h"), path.join(dir, "sub", "b.h")].sort());
  assert.equal(found.get(path.join(dir, "missing.h")), undefined);
});

test("cache: editing a local header recompiles the solution", { skip: !HAS_GPP && "g++ not installed" }, async () => {
  const dir = makeProblem({
    "solution.cpp": '#include <cstdio>\n#include "value.h"\nint main() { std::printf("%d\\n", VALUE); }\n',
    "value.h": "#define VALUE 1\n",
  });
  const src = path.join(dir, "solution.cpp");
  const cache = new ProgramCache();
  try {
    const run = async () => {
      const p = await cache.get(src);
      assert.ok(p.ok);
      const r = await judge(src, { cache, cases: [{ name: "1", input: "", expected: null }] });
      return { cached: !!p.cached, out: r.cases[0].output.trim() };
    };
    assert.deepEqual(await run(), { cached: false, out: "1" });
    assert.deepEqual(await run(), { cached: true, out: "1" });
    writeFileSync(path.join(dir, "value.h"), "#define VALUE 2\n");
    assert.deepEqual(await run(), { cached: false, out: "2" });
  } finally {
    await cache.clear();
  }
});

// ---- memory during the run, and the helper's child ----

test("going over the memory limit stops the program right away, not at the time limit", { skip: !(HAS_GPP && HAS_PY) && "needs g++ and python" }, async () => {
  // 200 MB, then spin forever: only stopping at the limit can end this before the time limit.
  const dir = makeProblem({
    "solution.py": "b = bytearray(200 * 1024 * 1024)\nfor i in range(0, len(b), 4096): b[i] = 1\nwhile True: pass\n",
    "meta.json": JSON.stringify({ timeLimit: 10, memoryLimit: 64 }),
    ".data/1.in": "",
    ".data/1.out": "",
  });
  const t0 = Date.now();
  const r = await judge(path.join(dir, "solution.py"));
  assert.equal(r.cases[0].verdict, "MLE", r.cases[0].message);
  assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0} ms`);
});

test("POSIX: on a time limit the helper's child dies too", { skip: (IS_WIN || !(HAS_GPP && HAS_PY)) && "POSIX with g++ and python" }, async () => {
  assert.ok(await getMemwatch("g++"));
  const dir = makeProblem({ "meta.json": JSON.stringify({ timeLimit: 1 }), ".data/1.in": "", ".data/1.out": "" });
  // The program writes its pid next to itself (an absolute path: it doesn't run in the problem folder).
  const src = path.join(dir, "solution.py");
  writeFileSync(src, `import os\nopen(${JSON.stringify(path.join(dir, "pid.txt"))}, 'w').write(str(os.getpid()))\nwhile True: pass\n`);
  const r = await judge(src);
  assert.equal(r.cases[0].verdict, "TLE");
  const pidFile = path.join(dir, "pid.txt");
  assert.ok(existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, "utf8"));
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), "the program was killed with its helper");
});
