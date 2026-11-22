# Progress log

Read with [PLAN.md](PLAN.md), which has the goal, the decisions and the full build order.
Last updated: 2026-11-22.

The extension is called **DSA Drill** (package `dsa-drill`, IDs and settings `dsaDrill.*`). It was "CP Judge"
until 2026-11-22; the folder is still `D:\cp-judge`. The old judge.py tool now sits in `legacy/` (gitignored).

## Where things stand

| Phase | Status |
|---|---|
| 1. Judge engine in TypeScript | ✅ Done |
| 2. Local VS Code extension | ✅ Done |
| 3. Problems from GitHub (sidebar, download, starters, update) | ✅ Done (tested against a local fixture repo; nothing pushed to GitHub yet) |
| 4. Authoring scripts + CI, port existing problems | ✅ Done 2026-11-22, pushed to GitHub (first commit 147ab9f) |
| 5. Polish (solved tracking, tags, publish) | ✅ Done 2026-11-22: solved tracking, filter, `.vsix` released as v0.1.0 on GitHub (Marketplace: not planned for now) |
| 6. Quick wins + stress test + run history | ✅ Done 2026-11-22 (90670ea), released as v0.2.0 on GitHub |
| 7. Hints + stats, checkers + memory limit | ✅ Done 2026-11-22 (not released; CHANGELOG has it under "Unreleased") |

The problems repo is **`realksm/dsa-practice`** (the default for `dsaDrill.repo`), public, branch `main`.
Pushed 2026-11-22. Checked the same day with the extension's own code (sourceFor + installProblem, from Node):
index.json loads with both problems, both download (tests land in `.data/`, with `.data/.source.json`),
and the judge runs on the downloaded copy. Not yet checked: the CI run result (GitHub API was rate-limited)
and the sidebar by eye in VS Code.

## How to pick up again

```
cd extension
npm install                  # only if node_modules/ is missing
npm test                     # 86 unit tests (engine, compile errors, problems/index/download, filter, solved, phases 6-7), about 8 s
npm run test:vscode          # 24 tests inside a real VS Code (judge, sidebar, filter/solved, warnings, stress, history, hints, stats, MLE, checker)
npm run package              # builds dsa-drill-<version>.vsix (gitignored) with vsce
npm run judge -- <solution>  # judge from the terminal
npm run index                # rebuild ../index.json from ../problems/ (--check: fail if stale)
```

Authoring, from the repo root (`D:\cp-judge`), also as tasks in `.vscode/tasks.json`:

```
npm run new <slug>           # scaffold problems/<slug>/ + references/<slug>/ref.cpp
npm run build                # ref on every .in -> .out, time-limit check, validate, rebuild index.json
npm run build -- --stress    # + ref vs naive on 200 inputs from gen.* (--stress N for N)
npm run check                # what CI runs: validation + index.json up to date, no compilers needed
```

- **Try it by hand:** open `D:\cp-judge` in VS Code and press **F5**. A second window opens on
  `extension/test/fixtures/workspace`. To try the sidebar without GitHub, set `dsaDrill.repo` to
  `D:\cp-judge\extension\test\fixtures\repo` (any local folder with a `problems/` folder works; with no
  `index.json` the index is built on the fly).
- **If `test:vscode` says "Code is currently being updated":** the installed VS Code had an unfinished
  update. Restart VS Code, or run `VSCODE_EXECUTABLE=download npm run test:vscode`, which uses the copy
  already downloaded into `extension/.vscode-test/` (gitignored). This happened again on 2026-11-22.

## What exists

```
extension/
  src/judge/compare.ts      token compare: ints exact (BigInt), decimals within eps, nan never matches
  src/judge/runner.ts       spawn with time limit, output cap, cancel; describeExit (0xC00000FD etc.)
  src/judge/languages.ts    cpp (g++ -O2, 256 MB stack + -static on Windows), java (Main.java, -Xss256m), python (resolved to sys.executable)
  src/judge/memory.ts       memwatch helper (C source, built once with g++ into %TEMP%/dsa-drill-memwatch-<hash>), runMeasured, Java flags
  src/judge/checker.ts      findChecker (.data/checker.*), Checker (testlib arg order, exit 0/1-2/other), CHECKER_TEMPLATE
  src/judge/tests.ts        reads .data/NN.in + NN.out|.ans (natural order), meta.json
  src/judge/cache.ts        ProgramCache: compiled programs per (path, compiler settings, source text), LRU of 8
  src/judge/stress.ts       stressTest (gen seed -> brute vs solution), saveStressCase, helper templates
  src/judge/judge.ts        judge(): every case with live progress; runOnInput(): custom input; runCase(program, case, CaseContext)
  src/problems/indexFile.ts index.json types, parseIndex (validates slugs and paths), buildIndex, hashFiles
  src/problems/source.ts    parseRepo; GitHubSource (raw.githubusercontent, pinned to a commit); LocalSource
  src/problems/install.ts   installProblem (download/update), addSolution, scanLocal, isOutdated
  src/problems/starters.ts  built-in starter templates per language
  src/problems/view.ts      Problems sidebar (TreeView) + open/refresh/update/filter/markUnsolved commands
  src/problems/solved.ts    SolvedStore: globalState key dsaDrill.solved, { "<repo label>::<slug>": { languages, firstAt, hash } }
  src/problems/history.ts   HistoryStore (runs per repo::slug, newest first, max 30), summariseRun, JsonFileStore
  src/problems/hints.ts     parseHints ("## " per hint), HintStore (globalState dsaDrill.hints, synced), HINTS_TEMPLATE
  src/problems/stats.ts     ActivityStore (runs per local day, key dsaDrill.activity in history.json), computeStats, streakOf
  src/problems/filter.ts    ProblemFilter { tags (any of), hideSolved }, stored in globalState key dsaDrill.filter
  src/problems/buildIndexCli.ts  npm run index
  src/cli.ts                terminal front end (npm run judge)
  src/extension.ts          commands, CodeLens, status bar, Problems-panel errors, ".data next to file" detection
  src/diagnostics.ts        parses g++ / javac error lines
  src/ui/resultsPanel.ts    webview panel host (state is pushed to the webview as one object)
  src/ui/hintsPanel.ts      hints webview (rebuilt on each change; markdown via markdown.api.render)
  src/ui/statsPanel.ts      stats webview: KPI tiles, heatmap (fixed run-count steps), meter lists; media/stats.css
  media/results.js|css      panel UI (theme colours, expand/collapse, diff line highlight, custom input box)
  media/icon.svg            activity bar icon
  test/*.test.ts            node:test unit tests
  test/vscode/run.ts        launches VS Code with the extension; copies fixtures/repo to a temp dir
  test/vscode/suite.ts      in-editor tests
  test/fixtures/workspace/  sample problems in the new layout (also the download target in the tests)
  test/fixtures/repo/       a tiny problems repo: add-two (easy, has a Python starter), max-pair (medium)
authoring/common.ts         paths, validateProblem/validateMeta (shared by build and check)
authoring/new.ts|build.ts|check.ts   the npm run new / build / check scripts
authoring/tsconfig.json     compiled by the extension's tsc (npm run compile:authoring in extension/)
                            into authoring/out/ (gitignored); rootDir is the repo root so it imports
                            extension/src/judge and indexFile directly
package.json (root)         only the three scripts; no dependencies of its own
problems/max-subarray/      10 tests (old 5 + overflow/all-negative/zeros + one n=2e5 case)
problems/two-sum/           11 tests (examples, duplicates, overflow, two n=2e5 cases)
references/<slug>/          ref.cpp, naive.cpp, gen.py for both (gitignored: back it up)
index.json                  generated by npm run build (2 problems)
.github/workflows/check.yml npm ci in extension/, then npm run check (Node 24, ubuntu)
.gitattributes              problems/** and index.json are eol=lf
.vscode/launch.json         F5 config
.vscode/tasks.json          Extension: build + Problems: new / build / build+stress / check
.gitignore                  references/, node_modules/, authoring/out/, legacy/
legacy/                     old judge.py, PROMPT.md, README.md, old problems, old tasks.json (not committed)
```

### Extension surface (package.json)

- **Commands:** `dsaDrill.runTests`, `dsaDrill.runCustomInput`, `dsaDrill.stop`, `dsaDrill.showResults`,
  `dsaDrill.refreshProblems`, `dsaDrill.openProblem`, `dsaDrill.openProblemInLanguage`, `dsaDrill.updateProblem`,
  `dsaDrill.updateAllProblems`.
  `runTests` returns the JudgeReport, `runCustomInput(uri, input)` returns the result,
  `openProblem(slug, language?)` returns `{ dir, solution, createdSolution }`, `updateProblem(slug)` returns
  the number updated. The tests use these return values.
- **Sidebar:** activity bar container `dsaDrill`, view `dsaDrill.problems`. Groups Easy, Medium, Hard, other
  difficulties, then Unrated. Icons: not downloaded / downloaded / tests updated (with an inline update
  button). Context menu: Open in Another Language, Update Tests. Errors show as one row in the tree
  (click: retry, or open settings when `dsaDrill.repo` can't be parsed).
- **Keybinding:** Ctrl+Alt+R (Cmd+Alt+R on Mac), only when the active file is a solution.
- **Settings:** `dsaDrill.repo` (default `realksm/dsa-practice`), `dsaDrill.workspaceFolder` (empty = first
  workspace folder; with no folder open it asks and saves the answer globally), `dsaDrill.defaultLanguage`,
  `dsaDrill.compilers.{cpp,javac,java,python}`, `dsaDrill.codeLens`, `dsaDrill.customInputTimeLimit`.
- **Hiding `.data`:** done with `configurationDefaults` for `files.exclude`, so the extension writes no settings
  file. A test confirms the defaults like `**/.git` are kept.
- **A "solution file":** any .cpp/.cc/.cxx/.java/.py file with a `.data/` folder next to it.

### index.json

```json
{ "version": 1, "problems": [ { "slug": "add-two", "title": "Add Two", "difficulty": "easy",
  "tags": ["math"], "files": [".data/01.in", ".data/01.out", "meta.json", "problem.md",
  "starters/solution.py"], "hash": "16 hex chars" } ] }
```

- `files` are relative to `problems/<slug>/`. `hash` covers everything except `starters/`, with CRLF
  normalised to LF, so a Windows checkout and Linux CI give the same hash and a starter edit doesn't count
  as a test change.
- buildIndex includes a folder only if it has `problem.md`, `meta.json` and at least one `.data/*.in`.
  Others are listed as skipped. An `.in` without an `.out` is a warning. `npm run check` turns both into
  errors: every folder under `problems/` is meant to be published.

### Downloaded problem layout

```
<workspaceFolder>/<slug>/problem.md, meta.json, solution.py (only created if missing)
<workspaceFolder>/<slug>/.data/01.in 01.out ... .source.json   { slug, hash, repo }
```

Opening a problem opens the solution on the left and the rendered `problem.md` on the right.

### meta.json fields the engine reads
`timeLimit` (seconds, default 2), `memoryLimit` (MB, none if absent), `exact`, `ignoreCase`, `eps`,
`timeMultipliers`. `title`, `difficulty`, `tags` are used by the index.

## Decisions made along the way

- **The engine compares integers exactly.** The old judge.py let `2e14` pass when off by `1e8`, and `nan` matched
  anything. Both are fixed and tested.
- **The C++ deep-recursion test** needs about 80 MB of stack. A simpler version got optimised away by g++ and
  proved nothing.
- **No ThemeIcon for the panel tab:** the VS Code 1.90 typings don't allow it. `engines.vscode` is `^1.90.0`.
- **TypeScript 7** (the Go-based `tsc`) is what npm installed. It works fine.
- **Java gets the same time limit as C++** for now, so JVM startup (about 100 ms) counts. Consider a multiplier later.
- **GitHub reads are pinned to a commit.** On refresh, one API call (`/repos/o/r/commits/HEAD`, header
  `Accept: application/vnd.github.sha`) turns the branch into a SHA, and every raw URL uses that SHA. This
  avoids the ~5 minute raw cache after a push, and the files always match the index. If the API fails
  (60 calls an hour without a token) it falls back to the branch name (`HEAD` by default).
- **Updating replaces `.data/` as a whole**, so test files a user added by hand are lost. `problem.md` and
  `meta.json` are replaced too. Solution files and any other files in the folder are never touched. All
  files are fetched before anything is written, and the new `.data` is built next to the old one and
  then renamed into place.
- **A folder with the same slug but no `.source.json`** (made by hand) shows as "tests updated", so the
  user can pull the real tests into it.
- **Clicking a problem** reopens your solution if there is exactly one. Otherwise it asks the language,
  unless `dsaDrill.defaultLanguage` is set and no solution exists yet. "Open in Another Language" always asks.
- The repo must be **public** (no token support).

## Known gaps / ideas (not blocking)

- The compile cache keys on the solution's own text only: a change to a local header it `#include`s
  isn't noticed until the solution changes (or VS Code restarts).
- C++ crashes (segfaults) aren't mapped to a line; only Python tracebacks and Java stack traces are.
- Not checked by eye in light/dark themes yet; only checked that it renders. The sidebar hasn't been
  looked at by eye either (its contents are checked by the tests).
- No proxy handling beyond what VS Code gives the global `fetch`.
- Memory on Mac isn't enforced during the run (checked afterwards, like Linux) and a killed helper
  can leave the child running there (Linux uses PR_SET_PDEATHSIG). Only Windows was tried by hand.
- Without g++ memory isn't measured at all (Python/Java users without g++); the panel says so.
- A checker can't `#include "testlib.h"` (only .in/.out/checker go in .data, and the compile cache
  ignores headers). Checkers are written by hand against the documented argument order.

## Phase 4 decisions (2026-11-22)

- `two-sum` was only a placeholder (its naive.cpp summed the array), so it got a real statement: print
  1-based `i j` with `a_i + a_j = t`, smallest `j` first, then smallest `i`; `-1` if none. Its old
  `tests.txt` had no target, so all its tests are new.
- `max-subarray`: the reference is a correct Kadane `ref.cpp`; the old naive.cpp (O(n^2)) is the stress
  naive, because it would be too slow on the n = 2e5 test.
- build.ts runs the reference with a timeout of 4x the limit (at least 10 s) so a slow reference reports its
  real time. Over the limit is an error; over half of it is a warning. A rewritten `.out` is printed as
  `CHANGED`. A stress mismatch saves the input to `references/<slug>/stress-<seed>.in`. With any error,
  index.json is not written.
- validateProblem also rejects old-layout files in a problem folder (tests.txt, naive.*, solution.*, ...),
  `TODO` left in problem.md, empty `.in` files, `.out` without `.in`, and bad meta (difficulty must be
  easy/medium/hard, timeLimit 0-30 s).
- `indexText()` in indexFile.ts is the one place that formats index.json (build, check and npm run index).
- The old tool was moved to `legacy/`, not deleted (no git history yet to recover it from).
- CI does not run the extension's unit tests (not yet tried on Linux).

## Phase 5 so far (2026-11-22)

- **Solved:** Run Tests marks a problem solved when every case is AC (NO_EXPECTED doesn't count) and the
  folder has `.data/.source.json` (i.e. it was downloaded; plain local folders are ignored). Key is the
  source label + slug, so `owner/repo@branch` counts separately from `owner/repo`. Synced via
  `globalState.setKeysForSync`. First solve shows "Solved "X"! (n/m solved)". Solved stays solved after a
  test update (the tooltip says the tests changed since).
- **Sidebar:** ✓ `pass-filled` icon (outdated's cloud icon still wins), group description `solved/total`,
  view description `n/m solved`, tooltip lists languages + first date. contextValue gets a `.solved` suffix;
  package.json menu regexes were updated to `^problem\.(local|outdated)(\.solved)?$` etc.
- **Filter:** title-bar filter button (multi-select quick pick: Hide solved + tags with counts). Tags match
  if the problem has any checked tag. Active filter shows as the view's message; the button turns into
  Clear Filter (context key `dsaDrill.filterActive`). `dsaDrill.filterProblems` also takes a filter object
  (used by the tests). Open Problem quick pick marks solved problems too.
- **Packaging:** version 0.1.0, extension/README.md (Marketplace page), CHANGELOG.md, LICENSE (MIT,
  also at repo root), repository/homepage/bugs, `.vscodeignore`, `@vscode/vsce` dev dependency.
  `npm run package` gives a 47 KB `.vsix` (27 files); it installs into a clean VS Code.
- The publisher id is still the placeholder `dsa-drill`; the Marketplace needs a real publisher.

## Phase 6 decisions (2026-11-22)

- **Compile cache** (`ProgramCache`, in-memory for the session, dirs in the OS temp folder, removed on
  deactivate). Key: lowercased path + compiler settings + file bytes. Failed compiles aren't kept
  (installing a missing compiler doesn't change the key). judge/runOnInput/stressTest take `cache`;
  the CLI and authoring scripts don't pass one and compile into a throwaway folder as before.
- **Time factor:** `timeLimitFor()` = base (opts.timeLimitMs, else meta.timeLimit, else 2 s) × factor;
  factor = setting > meta.json `timeMultipliers` > default (cpp 1, java 2, python 1). The report's
  `timeLimitMs` is the effective one. validateMeta checks `timeMultipliers` (known language, 0-10).
- **Warnings:** `prepare()` now returns `warnings` (compiler stderr+stdout on success); they're parsed with
  the same g++/javac parser and shown as warnings. `showCompilerOutput` adds to a file's diagnostics.
- **Runtime errors:** `parseRuntimeError` in diagnostics.ts. Python: last `File "<solution>", line N`
  frame; message = last unindented line. Java: first `at ...(Main.java:N)` frame; message = the exception
  line. Only the first RE case is marked, as "Case NN: <message>".
- **User tests on update:** `.source.json` now has `files` (the .data files the download wrote). On
  update, any other file in the old .data is copied into the new one, unless the new download has a
  file with that name. Older downloads with no list: a file is kept if the new download doesn't have it
  (so a test the repo deleted would survive once; the next update has the list).
- **Stress test:** helpers are `gen.*` and `brute.*` (any language; Java `Gen.java`/`Brute.java`) next to
  the solution; they get no CodeLens and aren't solution files. gen gets the seed as argv[1]; gen and
  brute have 10 s each; the solution gets its normal (factored) limit. Outcomes: passed / cancelled /
  missingHelpers / compileError / helperFailed (gen or brute crashed: their fault, not the solution's) /
  found. A found case is written to `.data/stress-<seed>.in` + `.out` (brute's output) and shown in
  the results panel with a note. Missing helpers: offer to create `gen.py` + `brute.<solution language>`.
  Setting `dsaDrill.stressRuns` (default 200). Stop / the notification's Cancel abort it.
- **History** is stored in `<globalStorage>/history.json`, **not** globalState. With both in globalState
  a run (history write, then the solved write right after) lost a history entry once in the VS Code
  tests; with its own file it passed 4 runs in a row. (The solved/filter keys still share globalState;
  no loss seen there, but worth knowing.) Only downloaded problems are recorded, like solved. CE counts
  as a run; cancelled runs and runs with only no-answer cases don't. Best = fastest AC by slowest case,
  preferring runs on the current test hash. Shown as "<n> ms" in the sidebar description + tooltip;
  right-click → Show Run History (quick pick).
- Results panel state has a `note` line (used by the stress test).
- `memento()` test helper moved to test/helpers.ts.

## Phase 7 decisions (2026-11-22)

- **memwatch:** Node can't see a child's memory, so solutions run under a small C helper compiled
  with the user's g++ (`-O2 -municode -static` on Windows). Args: `<limitMB> <report file> <command>`;
  on Windows the command is one pre-quoted command line (quoteWindowsArg). Report:
  `<peak bytes> <limit hit> <wall ms>` or `spawn_error <code>` (then the run is retried without the
  helper so "not installed" reads as before). The helper's wall time replaces Node's (C++ cases
  dropped from ~38 ms to ~5 ms because process start-up isn't counted).
- Windows: Job Object with KILL_ON_JOB_CLOSE (killing the helper on TLE/Stop kills the solution) and
  JOB_MEMORY limit; "limit hit" comes from the job's completion port. Peak = PeakJobMemoryUsed.
- Java isn't hard-capped (the JVM's own ~50 MB would count): `-Xmx<limit>m`, MLE = OutOfMemoryError.
  Always `-Xms16m -XX:+UseSerialGC`: committed memory 352 MB -> 47 MB with the same time.
- Python: `python` on this machine is the Windows Store alias, which starts the real interpreter
  outside the job (measured 10 MB for a 50 MB program, and Stop only killed the alias). prepare()
  now resolves it once with `sys.executable`.
- `-static` for C++ on Windows: Git Bash puts Git's mingw64/bin first on PATH and programs built by
  MSYS2's g++ loaded its libstdc++-6.dll and crashed (found through the checker template's ifstream).
- Checker lives in `.data/` (hidden like the tests, never taken for a solution file, part of the hash).
  A checker failure throws CheckerError for the whole run, worded as the problem's bug. Expected
  `null` (no .out) still gives NO_EXPECTED without running the checker.
- Hints are fetched from the source when asked (cached per hash for the session), not downloaded:
  no spoiler file next to the solution, and hint edits don't mark tests as changed. The sidebar item's
  contextValue gets a `.hints` suffix (menus' regexes allow it). Internal command
  `dsaDrill.hintAction next|reset` backs the panel buttons (and the tests).
- Activity: `{ "YYYY-MM-DD": { runs, accepted } }` by local date, in history.json next to the runs,
  seeded once from the existing history. Recorded before history.add so the stats redraw sees it.
- Stats page drawn server-side into webview.html (style-src allows 'unsafe-inline' for bar widths).
  Checked by eye in light and dark (headless Brave screenshots of the page with theme variables).

## Releases

- **v0.1.0** (2026-11-22): https://github.com/realksm/dsa-practice/releases/tag/v0.1.0, with
  `dsa-drill-0.1.0.vsix` attached (SHA-256 5d43bf0e...070fcf). CI (`check`) green on every push so far.
- **v0.2.0** (2026-11-22): https://github.com/realksm/dsa-practice/releases/tag/v0.2.0, with
  `dsa-drill-0.2.0.vsix` attached (SHA-256 3d5a29ec...c097858). CI green on main (1d6dc35) and the tag.
- New release: bump `version` in extension/package.json + CHANGELOG.md, `npm run package` in extension/,
  commit, `git tag -a vX.Y.Z`, push with the tag, then
  `gh release create vX.Y.Z extension/dsa-drill-X.Y.Z.vsix --notes-file <notes>` (gh is installed and logged in).

## Next steps

0. Phase 7 is built and tested (86 unit + 24 VS Code tests), not committed yet. Try hints, stats,
   MLE and a checker by hand (F5), then release 0.3.0. Also still to do: try Stress Test and the history by hand. The stray `max-subarray/` and `two-sum/` at the repo root
   are downloaded copies from the GitHub check, not part of the repo.
1. Look at the sidebar by eye in light and dark themes (icons, filter message, counts).
2. Back up `references/`; delete `legacy/` when no longer wanted.
3. Later, if wanted: Marketplace publish (real publisher id in package.json, 128x128 PNG icon,
   `npx vsce login` + `npx vsce publish`).
4. More problems: `npm run new <slug>` (add `-- --checker --hints` as needed), `npm run build -- --stress`, commit, push.
   The two published problems have no hints.md yet.
