import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseCompileErrors, sameFile } from "../src/diagnostics";

test("parses g++ errors and warnings", () => {
  const out = [
    "C:\\tmp\\p\\solution.cpp: In function 'int main()':",
    "C:\\tmp\\p\\solution.cpp:5:10: error: 'x' was not declared in this scope",
    "    5 |     cout << x;",
    "      |             ^",
    "C:\\tmp\\p\\solution.cpp:3:7: warning: unused variable 'y' [-Wunused-variable]",
  ].join("\r\n");
  assert.deepEqual(parseCompileErrors(out), [
    { file: "C:\\tmp\\p\\solution.cpp", line: 5, column: 10, severity: "error", message: "'x' was not declared in this scope" },
    { file: "C:\\tmp\\p\\solution.cpp", line: 3, column: 7, severity: "warning", message: "unused variable 'y' [-Wunused-variable]" },
  ]);
});

test("parses javac errors with the symbol detail", () => {
  const out = [
    "D:\\p\\Main.java:4: error: cannot find symbol",
    "        System.out.println(x);",
    "                           ^",
    "  symbol:   variable x",
    "  location: class Main",
    "1 error",
  ].join("\n");
  assert.deepEqual(parseCompileErrors(out), [
    { file: "D:\\p\\Main.java", line: 4, column: 1, severity: "error", message: "cannot find symbol (symbol:   variable x)" },
  ]);
});

test("ignores linker noise it can't place", () => {
  assert.deepEqual(parseCompileErrors("collect2.exe: error: ld returned 1 exit status"), []);
});

test("sameFile matches by full path or name", () => {
  assert.ok(sameFile("/a/b/solution.cpp", "/a/b/solution.cpp"));
  assert.ok(sameFile("solution.cpp", "/x/y/solution.cpp"));
  assert.ok(!sameFile("other.cpp", "/x/y/solution.cpp"));
});
