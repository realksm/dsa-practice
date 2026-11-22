# DSA Drill: VS Code extension plan

> Current status, how to resume and next steps: see [PROGRESS.md](PROGRESS.md).

## Goal

A VS Code extension for practice problems. I (the only author) push problems to one
GitHub repo. Everyone with the extension sees new problems, opens one, writes a solution
in C++, Java or Python, and runs the tests with one click.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| Who publishes | Only me | No publish UI in the extension. I push with git like normal. |
| Purpose | Practice | Tests may be readable. `.data/` is hidden for tidiness, not security. |
| Repos | One repo | Extension code, problems and authoring scripts live together. |
| Judge | Rewrite in TypeScript | Users need only their compiler, not Python. |
| Expected answers | Stored `.out` files | Generated from my reference solution, never hand-written. |
| Reference solutions | Not committed | Kept in a gitignored `references/` folder (back it up). |

## Repo layout

```
cp-judge/
  extension/                 VS Code extension (TypeScript)
    src/judge/               compile, run, compare (port of judge.py)
    src/problems/            fetch index, download problem, sidebar
    src/ui/                  results panel, "Run Tests" buttons above the code (CodeLens)
  problems/
    two-sum/
      problem.md
      meta.json              { title, difficulty, tags, timeLimit, memoryLimit }
      .data/01.in 01.out ...
      starters/solution.cpp  Main.java  solution.py   (optional)
  authoring/                 my scripts (Node)
    new.ts                   scaffold problems/<slug> + references/<slug>
    build.ts                 run ref on every .in, write .out, validate, rebuild index.json
  references/                GITIGNORED: <slug>/ref.cpp, gen.py, naive.cpp
  index.json                 generated: list of problems + file lists + content hash
  .github/workflows/check.yml  checks every problem has .in/.out pairs + valid meta
```

## User side

1. Sidebar **Problems** panel lists everything in `index.json` (grouped by difficulty, ✓ if solved).
2. Click a problem, then pick a language. The extension downloads `problem.md` and `.data/`
   from `raw.githubusercontent.com` into the user's workspace and creates the starter:
   ```
   two-sum/
     problem.md
     solution.cpp      (or Main.java / solution.py)
     .data/            hidden via files.exclude
   ```
3. **▶ Run Tests** (CodeLens above the code, or Ctrl+Shift+B) shows PASS/WA/TLE/RE per case
   in a results panel. A failing case shows its input, the expected output and the user's output.
   **Run Custom Input** runs input the user types, with no comparison.
4. Refresh re-fetches `index.json` (raw GitHub URLs can lag about 5 minutes after a push).
   If a problem's tests changed (the hash differs), offer to update `.data/` without touching the solution.

Settings: `dsaDrill.repo` (default: the one repo), `dsaDrill.compilers.{cpp,java,python}`,
`dsaDrill.defaultLanguage`, `dsaDrill.workspaceFolder`.

## My side (authoring)

```
npm run new two-sum        creates problems/two-sum + references/two-sum
  write problem.md, meta.json, .data/*.in, references/two-sum/ref.cpp
npm run build              runs ref → writes .out, checks time limit, rebuilds index.json
  optional: stress ref vs naive with gen.py before trusting it
git push                   users see it on next refresh
```

## Judge engine (port of judge.py, with fixes)

- Compile/run: g++ `-std=c++17 -O2` (+ a 256 MB stack on Windows), javac/java, python.
- Compare token by token. Integers are compared **exactly**. Decimals use 1e-6 tolerance.
  NaN never matches.
- Per-case time limit from meta.json, kill on timeout, decode output as UTF-8 with replacement.
- Show the exit code in hex on Windows (0xC00000FD = stack overflow).

## Build order

1. ✅ **Judge engine** in TS with unit tests (including the comparison bugs found in judge.py).
   Done: `extension/src/judge/`, 30 tests in `extension/test/`, CLI at `extension/src/cli.ts`.
2. ✅ **Local extension**: Run Tests on a folder containing `.data/`, results panel, CodeLens.
   Done: `extension/src/extension.ts`, `src/ui/`, `media/`. 9 in-VS-Code tests (`npm run test:vscode`).
3. ✅ **Problems repo**: index.json, sidebar, download + starter, refresh/update.
   Done: `extension/src/problems/`, `npm run index`. Tested against a local fixture repo.
4. ✅ **Authoring scripts + CI check**; port max-subarray and two-sum as the first problems.
   Done: `authoring/`, `npm run new|build|check`, `.github/workflows/check.yml`. Pushed 2026-11-22.
5. **Polish**: solved tracking, tags/filter, Marketplace publish.

Phases 1–2 already replace judge.py for local use.

## Open items

- ~~GitHub owner/repo name~~: `realksm/dsa-practice` (the default `dsaDrill.repo`). Must be public.
- Marketplace publish vs sharing a `.vsix` file with friends (`.vsix` is simpler to start).
