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
- **Compile errors** go to the Problems panel, on the right line.
- **Solved tracking:** a problem is marked ✓ once every test passes. Counts show in the sidebar,
  and your solved list follows you through Settings Sync. Right-click → **Mark as Unsolved** to reset one.
- **Filter:** the filter button in the sidebar narrows the list by tag or hides solved problems.
- **Test updates:** when a problem's tests change, the sidebar marks it, and **Update Tests** fetches
  the new ones without touching your solution.

## Judging rules

- Output is compared token by token. Integers must match exactly; decimals are accepted within 1e-6.
- Each problem has a time limit per test (in its `meta.json`). Java and Python get the same limit as C++.
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

Problems and source: [github.com/realksm/dsa-practice](https://github.com/realksm/dsa-practice).
