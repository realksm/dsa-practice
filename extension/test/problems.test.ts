import * as assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import * as path from "path";
import { test } from "node:test";
import { buildIndex, hashFiles, IndexEntry, isSafeRelPath, parseIndex } from "../src/problems/indexFile";
import { addSolution, installProblem, isOutdated, scanLocal, SOURCE_INFO } from "../src/problems/install";
import { FetchLike, GitHubSource, LocalSource, parseRepo, ProblemSource } from "../src/problems/source";
import { BUILTIN_STARTERS } from "../src/problems/starters";
import { makeProblem } from "./helpers";

const repoFiles = {
  "problems/add-two/problem.md": "# Add two\n",
  "problems/add-two/meta.json": JSON.stringify({ title: "Add Two", difficulty: "Easy", tags: ["math"], timeLimit: 1 }),
  "problems/add-two/.data/01.in": "1 2\n",
  "problems/add-two/.data/01.out": "3\n",
  "problems/add-two/.data/02.in": "5 5\n",
  "problems/add-two/.data/02.out": "10\n",
  "problems/add-two/starters/solution.py": "# starter from the repo\n",
  "problems/no-out/problem.md": "x",
  "problems/no-out/meta.json": "{}",
  "problems/no-out/.data/1.in": "1\n",
  "problems/old-layout/tests.txt": "1\n---\n2\n",
  "problems/old-layout/solution.cpp": "",
  "problems/Bad_Name/problem.md": "",
};

test("parseRepo accepts the usual spellings", () => {
  assert.deepEqual(parseRepo("realksm/dsa-practice"), { kind: "github", owner: "realksm", repo: "dsa-practice" });
  assert.deepEqual(parseRepo(" realksm/dsa-practice@dev "), { kind: "github", owner: "realksm", repo: "dsa-practice", ref: "dev" });
  assert.deepEqual(parseRepo("https://github.com/realksm/dsa-practice"), { kind: "github", owner: "realksm", repo: "dsa-practice" });
  assert.deepEqual(parseRepo("https://github.com/realksm/dsa-practice.git"), { kind: "github", owner: "realksm", repo: "dsa-practice" });
  assert.deepEqual(parseRepo("github.com/realksm/dsa-practice/"), { kind: "github", owner: "realksm", repo: "dsa-practice" });
  assert.deepEqual(parseRepo("https://github.com/realksm/dsa-practice/tree/feature/x"), {
    kind: "github",
    owner: "realksm",
    repo: "dsa-practice",
    ref: "feature/x",
  });
  const local = parseRepo(process.platform === "win32" ? "D:\\cp-judge" : "/home/me/cp-judge");
  assert.equal(local.kind, "local");
  assert.throws(() => parseRepo(""), /No problems repository/);
  assert.throws(() => parseRepo("just-a-name"), /not a GitHub repo/);
});

test("index file paths must stay inside the problem folder", () => {
  for (const ok of ["problem.md", ".data/01.in", "starters/Main.java"]) assert.ok(isSafeRelPath(ok), ok);
  for (const bad of ["", "../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "./a"]) assert.ok(!isSafeRelPath(bad), bad);
  assert.throws(() => parseIndex(JSON.stringify({ version: 1, problems: [{ slug: "x", title: "X", files: ["../evil"], hash: "h" }] })), /bad file path/);
  assert.throws(() => parseIndex(JSON.stringify({ version: 1, problems: [{ slug: "../x", files: [], hash: "h" }] })), /bad slug/);
  assert.throws(() => parseIndex(JSON.stringify({ version: 99, problems: [] })), /Update the extension/);
  assert.throws(() => parseIndex("<html>"), /not valid JSON/);
});

test("hash ignores line endings and file order, not content", () => {
  const a = hashFiles([
    { rel: "a.in", content: Buffer.from("1\n2\n") },
    { rel: "b.in", content: Buffer.from("x") },
  ]);
  const crlf = hashFiles([
    { rel: "b.in", content: Buffer.from("x") },
    { rel: "a.in", content: Buffer.from("1\r\n2\r\n") },
  ]);
  assert.equal(a, crlf);
  assert.notEqual(a, hashFiles([{ rel: "a.in", content: Buffer.from("1\n3\n") }, { rel: "b.in", content: Buffer.from("x") }]));
  // moving content between files changes the hash too
  assert.notEqual(hashFiles([{ rel: "a", content: Buffer.from("xy") }]), hashFiles([{ rel: "ax", content: Buffer.from("y") }]));
});

test("buildIndex lists valid problems and explains the skipped ones", async () => {
  const root = makeProblem(repoFiles);
  const { index, skipped, warnings } = await buildIndex(root);
  assert.deepEqual(
    index.problems.map((p) => p.slug),
    ["add-two", "no-out"],
  );
  const add = index.problems[0];
  assert.equal(add.title, "Add Two");
  assert.equal(add.difficulty, "easy");
  assert.deepEqual(add.tags, ["math"]);
  assert.deepEqual(add.files, [".data/01.in", ".data/01.out", ".data/02.in", ".data/02.out", "meta.json", "problem.md", "starters/solution.py"]);
  assert.deepEqual(
    skipped.map((s) => s.slug),
    ["Bad_Name", "old-layout"],
  );
  assert.match(skipped[1].reason, /problem\.md, meta\.json, \.data\/\*\.in/);
  assert.deepEqual(
    warnings.map((w) => `${w.slug}: ${w.message}`),
    ["no-out: .data/1.in has no expected output (.out)", "no-out: meta.json has no title"],
  );

  // a starter change doesn't count as "tests updated"; a test change does
  writeFileSync(path.join(root, "problems/add-two/starters/solution.py"), "# changed\n");
  assert.equal((await buildIndex(root)).index.problems[0].hash, add.hash);
  writeFileSync(path.join(root, "problems/add-two/.data/02.out"), "11\n");
  assert.notEqual((await buildIndex(root)).index.problems[0].hash, add.hash);
});

const entryOf = async (source: ProblemSource, slug: string) => (await source.loadIndex()).problems.find((p) => p.slug === slug)!;

test("installProblem downloads the problem and creates the starter", async () => {
  const source = new LocalSource(makeProblem(repoFiles));
  const dest = makeProblem({});
  const entry = await entryOf(source, "add-two");

  const r = await installProblem(source, entry, dest, { language: "python" });
  const dir = path.join(dest, "add-two");
  assert.equal(r.dir, dir);
  assert.equal(r.solution, path.join(dir, "solution.py"));
  assert.ok(r.createdSolution);
  assert.equal(readFileSync(r.solution!, "utf8"), "# starter from the repo\n");
  assert.equal(readFileSync(path.join(dir, ".data", "02.out"), "utf8"), "10\n");
  assert.ok(existsSync(path.join(dir, "problem.md")) && existsSync(path.join(dir, "meta.json")));
  assert.ok(!existsSync(path.join(dir, "starters")), "starters/ is not copied");
  const info = JSON.parse(readFileSync(path.join(dir, ".data", SOURCE_INFO), "utf8"));
  assert.deepEqual(info, { slug: "add-two", hash: entry.hash, repo: source.label });

  // no repo starter for C++: the built-in one
  const cpp = await addSolution(source, entry, dest, "cpp");
  assert.ok(cpp.createdSolution);
  assert.equal(readFileSync(cpp.solution!, "utf8"), BUILTIN_STARTERS.cpp);

  const local = await scanLocal(dest, [entry]);
  assert.deepEqual(Object.keys(local.get("add-two")!.solutions).sort(), ["cpp", "python"]);
  assert.ok(!isOutdated(entry, local.get("add-two")));
});

test("an existing solution is never overwritten", async () => {
  const source = new LocalSource(makeProblem(repoFiles));
  const dest = makeProblem({ "add-two/solution.py": "my work\n" });
  const entry = await entryOf(source, "add-two");
  const r = await installProblem(source, entry, dest, { language: "python" });
  assert.ok(!r.createdSolution);
  assert.equal(readFileSync(r.solution!, "utf8"), "my work\n");
  const again = await addSolution(source, entry, dest, "python");
  assert.ok(!again.createdSolution);
  assert.equal(readFileSync(r.solution!, "utf8"), "my work\n");
});

test("updating replaces .data and the statement, and keeps the solution and other files", async () => {
  const repo = makeProblem(repoFiles);
  const source = new LocalSource(repo);
  const dest = makeProblem({});
  const old = await entryOf(source, "add-two");
  await installProblem(source, old, dest, { language: "python" });
  const dir = path.join(dest, "add-two");
  writeFileSync(path.join(dir, "solution.py"), "my work\n");
  writeFileSync(path.join(dir, "notes.txt"), "mine\n");

  rmSync(path.join(repo, "problems/add-two/.data/01.in"));
  rmSync(path.join(repo, "problems/add-two/.data/01.out"));
  writeFileSync(path.join(repo, "problems/add-two/.data/03.in"), "7 8\n");
  writeFileSync(path.join(repo, "problems/add-two/.data/03.out"), "15\n");
  writeFileSync(path.join(repo, "problems/add-two/problem.md"), "# Add two (v2)\n");
  const fresh = await entryOf(source, "add-two");
  assert.notEqual(fresh.hash, old.hash);
  assert.ok(isOutdated(fresh, (await scanLocal(dest, [fresh])).get("add-two")));

  const r = await installProblem(source, fresh, dest);
  assert.equal(r.solution, undefined);
  assert.ok(!existsSync(path.join(dir, ".data", "01.in")), "removed test is gone");
  assert.equal(readFileSync(path.join(dir, ".data", "03.out"), "utf8"), "15\n");
  assert.equal(readFileSync(path.join(dir, "problem.md"), "utf8"), "# Add two (v2)\n");
  assert.equal(readFileSync(path.join(dir, "solution.py"), "utf8"), "my work\n");
  assert.equal(readFileSync(path.join(dir, "notes.txt"), "utf8"), "mine\n");
  assert.ok(!isOutdated(fresh, (await scanLocal(dest, [fresh])).get("add-two")));
});

test("a failed download leaves the existing copy alone", async () => {
  const source = new LocalSource(makeProblem(repoFiles));
  const dest = makeProblem({});
  const entry = await entryOf(source, "add-two");
  await installProblem(source, entry, dest);
  const flaky: ProblemSource = {
    label: "flaky",
    loadIndex: () => source.loadIndex(),
    readProblemFile: async (slug, rel) => {
      if (rel === ".data/02.out") throw new Error("connection reset");
      return source.readProblemFile(slug, rel);
    },
  };
  await assert.rejects(installProblem(flaky, entry, dest), /connection reset/);
  assert.equal(readFileSync(path.join(dest, "add-two", ".data", "02.out"), "utf8"), "10\n");
});

test("a hand-made folder with the same name counts as outdated", async () => {
  const entry: IndexEntry = { slug: "x", title: "X", files: [], hash: "abc" };
  const dest = makeProblem({ "x/.data/1.in": "1\n" });
  const local = (await scanLocal(dest, [entry])).get("x");
  assert.ok(local);
  assert.equal(local.hash, undefined);
  assert.ok(isOutdated(entry, local));
  assert.ok(!isOutdated(entry, undefined), "not downloaded is not outdated");
});

function fakeFetch(routes: Record<string, { status: number; body: string } | Error>) {
  const calls: string[] = [];
  const f: FetchLike = async (url) => {
    calls.push(url);
    const r = routes[url] ?? { status: 404, body: "404: Not Found" };
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
      arrayBuffer: async () => new TextEncoder().encode(r.body).buffer as ArrayBuffer,
    };
  };
  return { f, calls };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const INDEX = JSON.stringify({ version: 1, problems: [{ slug: "two-sum", title: "Two Sum", files: ["problem.md"], hash: "h" }] });

test("GitHubSource pins reads to the commit the index came from", async () => {
  const { f, calls } = fakeFetch({
    "https://api.github.com/repos/realksm/dsa-practice/commits/HEAD": { status: 200, body: SHA + "\n" },
    [`https://raw.githubusercontent.com/realksm/dsa-practice/${SHA}/index.json`]: { status: 200, body: INDEX },
    [`https://raw.githubusercontent.com/realksm/dsa-practice/${SHA}/problems/two-sum/.data/01.in`]: { status: 200, body: "1 2\n" },
  });
  const src = new GitHubSource({ owner: "realksm", repo: "dsa-practice" }, f);
  assert.equal(src.label, "realksm/dsa-practice");
  const idx = await src.loadIndex();
  assert.equal(idx.problems[0].slug, "two-sum");
  assert.equal((await src.readProblemFile("two-sum", ".data/01.in")).toString(), "1 2\n");
  assert.equal(calls.length, 3);
});

test("GitHubSource falls back to the branch when the API fails, and explains a 404", async () => {
  const { f, calls } = fakeFetch({
    "https://api.github.com/repos/o/r/commits/dev": { status: 403, body: "rate limited" },
    "https://raw.githubusercontent.com/o/r/dev/index.json": { status: 200, body: INDEX },
  });
  const src = new GitHubSource({ owner: "o", repo: "r", ref: "dev" }, f);
  await src.loadIndex();
  assert.equal(src.pinned, "dev");
  await assert.rejects(src.readProblemFile("two-sum", "problem.md"), /problems\/two-sum\/problem\.md not found in o\/r@dev/);
  assert.equal(calls.at(-1), "https://raw.githubusercontent.com/o/r/dev/problems/two-sum/problem.md");

  const offline = fakeFetch({ "https://api.github.com/repos/o/r/commits/HEAD": new Error("ENOTFOUND"), "https://raw.githubusercontent.com/o/r/HEAD/index.json": new Error("ENOTFOUND") });
  await assert.rejects(new GitHubSource({ owner: "o", repo: "r" }, offline.f).loadIndex(), /Couldn't reach GitHub/);
});
