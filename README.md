# DSA Drill

Practice data structures and algorithms problems inside VS Code. Open a problem from the
sidebar, write a solution in C++, Java or Python, and run its tests with one click.

This repo holds the extension (`extension/`) and the problems it shows (`problems/`).

## Using it

1. Install the extension (a `.vsix` file for now: **Extensions → ⋯ → Install from VSIX…**).
2. You need a compiler for your language on the PATH: `g++`, a JDK (`javac` + `java`), or Python 3.
   Each can also be set in the settings (`dsaDrill.compilers.*`).
3. Open a folder, then the **DSA Drill** panel in the activity bar. Click a problem and pick a language.
4. Write your solution and press **▶ Run Tests** above the code (or Ctrl+Alt+R).
   Each test shows PASS / WA / TLE / RE; a failing test shows its input, the expected output and yours.

Programs read standard input and print to standard output. Integers must match exactly;
decimals are accepted within 1e-6.

## Problem format

```
problems/<slug>/
  problem.md          statement
  meta.json           { "title", "difficulty": "easy|medium|hard", "tags", "timeLimit" (seconds) }
  .data/01.in 01.out  tests; every .out is generated from a reference solution
  starters/           optional: solution.cpp, Main.java, solution.py
index.json            generated list of all problems, read by the extension
```

## Adding problems (maintainer)

Reference solutions live in `references/<slug>/`, which is gitignored and never committed.
Commands run from the repo root after `npm ci` in `extension/`:

```
npm run new <slug>            create problems/<slug>/ and references/<slug>/ref.cpp
npm run build                 run each reference on every .in, write the .out files,
                              check the time limit, validate, rebuild index.json
npm run build -- <slug>       only that problem
npm run build -- --stress     also compare ref with references/<slug>/naive.* on
                              200 random inputs from gen.* (seed = argv[1])
npm run check                 what CI runs: every problem is valid and index.json is current
```

Then commit and push. The extension shows new problems on its next refresh (raw GitHub files
can take about 5 minutes to update).
