# DSA Drill

Practice data structures and algorithms problems inside VS Code. Pick a problem from the sidebar,
solve it in C++, Java or Python, and run its tests with one click.

## Getting started

1. Have a compiler for your language on the PATH: `g++`, a JDK (`javac` and `java`), or Python 3.
   You can also set full paths in the settings (`dsaDrill.compilers.*`).
2. Open a folder for your solutions, then open the **DSA Drill** panel in the activity bar.
3. Click a problem and pick a language. The statement opens beside a starter solution file.
4. Press **▶ Run Tests** above the code (or Ctrl+Alt+R / Cmd+Alt+R).

Programs read standard input and print to standard output, as on Codeforces or AtCoder.

## Features

- **Results panel:** PASS / WA / TLE / RE for every test, with time. A failing test shows its input,
  the expected output, your output and the first line that differs.
- **Run Custom Input:** run your program on input you type, without comparing.
- **Compile errors and warnings** go to the Problems panel, on the right line. When a Python or Java
  solution crashes, the line it crashed on is marked too.
- **Stress Test:** put a generator (`gen.py`, prints a random input for the seed in `argv[1]`) and a
  slow but surely correct `brute.*` next to your solution; Stress Test runs both on seeds 1..200 and
  stops at the first input where your solution disagrees, crashes or is too slow. That input is saved
  as `.data/stress-<seed>.in` / `.out`, so Run Tests checks it from then on. It offers to create both
  helper files from templates.
- **Run history:** every Run Tests of a downloaded problem is kept (verdict, slowest case, language).
  The sidebar shows your best time; right-click → **Show Run History** lists recent runs.
- **Fast reruns:** a file is compiled once until you change it, across Run Tests, Custom Input and Stress Test.
- **Solved tracking:** a problem is marked ✓ once every test passes. Counts show in the sidebar,
  and your solved list follows you through Settings Sync. Right-click → **Mark as Unsolved** to reset one.
- **Filter:** the filter button in the sidebar narrows the list by tag or hides solved problems.
- **Test updates:** when a problem's tests change, the sidebar marks it, and **Update Tests** fetches
  the new ones without touching your solution. Test files you added to `.data/` yourself are kept.

## Judging rules

- Output is compared token by token. Integers must match exactly; decimals are accepted within 1e-6.
- Each problem has a time limit per test (in its `meta.json`), set for C++. Java gets twice that by
  default (JVM startup); Python gets the same. A problem can change this with `timeMultipliers` in its
  `meta.json`, and you can with the `dsaDrill.timeMultipliers` setting.
- C++ is compiled with `-std=c++17 -O2`, with a 256 MB stack on Windows.

## Settings

| Setting | What it does |
|---|---|
| `dsaDrill.repo` | Where problems come from: a public GitHub repo (`owner/repo`) or a local folder with a `problems/` folder. |
| `dsaDrill.workspaceFolder` | Folder that opened problems are downloaded into. Empty = the first workspace folder. |
| `dsaDrill.defaultLanguage` | Language for newly opened problems. Empty = ask each time. |
| `dsaDrill.compilers.cpp` / `javac` / `java` / `python` | Compiler or interpreter command or full path. |
| `dsaDrill.codeLens` | Show the Run Tests links above solution files. |
| `dsaDrill.customInputTimeLimit` | Seconds a Run Custom Input run may take. |
| `dsaDrill.timeMultipliers` | Time limit factor per language, e.g. `{ "python": 3 }`. |
| `dsaDrill.stressRuns` | How many random inputs Stress Test tries (default 200). |

Problems and source: [github.com/realksm/dsa-practice](https://github.com/realksm/dsa-practice).
