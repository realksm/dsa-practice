import { test } from "node:test";
import * as assert from "node:assert/strict";
import { firstDifference, outputsMatch, tokensEqual } from "../src/judge/compare";

test("whitespace and newlines don't matter by default", () => {
  assert.ok(outputsMatch("1 2\n3\n", "1\n2 3"));
  assert.ok(outputsMatch("  5  \r\n", "5"));
  assert.ok(outputsMatch("", "\n"));
});

test("different token count fails", () => {
  assert.ok(!outputsMatch("1 2", "1 2 3"));
  assert.ok(!outputsMatch("", "0"));
});

test("integers are compared exactly, even huge ones (judge.py bug)", () => {
  assert.ok(!tokensEqual("200000100000000", "200000000000000"));
  assert.ok(!tokensEqual("1000000000000000001", "1000000000000000000"));
  assert.ok(tokensEqual("123456789012345678901234567890", "123456789012345678901234567890"));
  assert.ok(tokensEqual("-0", "0"));
  assert.ok(tokensEqual("+7", "7"));
  assert.ok(tokensEqual("007", "7"));
});

test("decimals use tolerance", () => {
  assert.ok(tokensEqual("3.1415926", "3.14159265"));
  assert.ok(tokensEqual("0.333333", "0.3333333333"));
  assert.ok(!tokensEqual("3.14", "3.15"));
  assert.ok(tokensEqual("3.0000000001", "3"));
  assert.ok(tokensEqual("1e5", "100000.0"));
  assert.ok(tokensEqual(".5", "0.5"));
  // relative tolerance for large decimals
  assert.ok(tokensEqual("1000000000.5", "1000000000.0"));
  assert.ok(!tokensEqual("1.5", "1.0", false, 1e-6));
  assert.ok(tokensEqual("1.5", "1.0", false, 1));
});

test("nan and inf never match a number (judge.py bug)", () => {
  assert.ok(!tokensEqual("nan", "3.5"));
  assert.ok(!tokensEqual("NaN", "0"));
  assert.ok(!tokensEqual("inf", "1e308"));
  assert.ok(!tokensEqual("1e400", "1e400.0"));
  assert.ok(tokensEqual("nan", "nan"));
});

test("words must match exactly unless ignoreCase", () => {
  assert.ok(!outputsMatch("yes", "YES"));
  assert.ok(outputsMatch("yes", "YES", { ignoreCase: true }));
  assert.ok(!outputsMatch("0x10", "16"));
});

test("exact mode compares lines, ignoring trailing spaces and blank lines", () => {
  assert.ok(outputsMatch("a b  \r\nc\n\n\n", "a b\nc", { exact: true }));
  assert.ok(!outputsMatch("a  b", "a b", { exact: true }));
  assert.ok(!outputsMatch("a\nb", "a b", { exact: true }));
});

test("firstDifference points at the first wrong line", () => {
  assert.deepEqual(firstDifference("1\n2\n4\n", "1\n2\n3\n"), { line: 3, got: "4", expected: "3" });
  assert.deepEqual(firstDifference("1\n", "1\n2\n"), { line: 2, got: "<missing>", expected: "2" });
  assert.deepEqual(firstDifference("1\n2\n3\n", "1\n2\n"), { line: 3, got: "3", expected: "<missing>" });
  assert.equal(firstDifference("1.0000001\n", "1\n"), null);
});
