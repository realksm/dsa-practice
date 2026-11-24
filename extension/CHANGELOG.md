# Changelog

## Unreleased

- Opening a problem in a window with no file open now puts the statement beside the solution, not
  in a tab behind it.
- A crash's error output no longer starts with an empty line.
- README: a walkthrough with screenshots (taken by `npm run screenshots`).

## 0.4.0 (2026-11-24)

- C++ crashes now show where they happened: "Crashed at ... (solution.cpp:12)" in the results panel,
  and the line is marked in the editor, for bad pointers, division by zero, stack overflows, failed
  asserts and uncaught exceptions (Windows, Linux and Mac; on a Mac it needs Xcode's command line
  tools, which come with g++ there).
- Editing a header next to your solution (`#include "my.h"`) now recompiles it.
- Linux and Mac: going over the memory limit stops the program at once (MLE) instead of running on
  to the time limit, and a stopped run no longer leaves the program running on Mac.
- Mac: `#include <bits/stdc++.h>` now works with Apple's g++ (clang), and C++ gets a 256 MB stack
  (before, macOS capped it at 64 MB).

## 0.3.1 (2026-11-24)

- Linux and Mac: C++ (and every other solution run under the memory helper) now gets a 256 MB stack,
  like Windows and the online judges. Before, deep recursion crashed at the 8 MB default.

## 0.3.0 (2026-11-22)

- Memory limit: `memoryLimit` in meta.json is now enforced, with a new MLE verdict. Peak memory shows
  per test in the results panel, in Custom Input and in the run history. Measured by a small helper
  built once with g++ (a Job Object on Windows); Java's heap is capped with `-Xmx`.
- Custom checkers: a problem's `.data/checker.cpp` / `checker.py` decides when several answers are
  right, in Run Tests and Stress Test alike.
- Hints: `hints.md`, opened one at a time from a CodeLens or the sidebar; how far you got is remembered.
- Stats view: solved per difficulty and tag, daily streak, a year of activity.
- Java runs with a small starting heap and the serial GC (about 50 MB instead of 350 MB, same speed).
- Python runs the real interpreter instead of a launcher (Windows Store alias, `py`): faster per test,
  and Stop / the time limit now end it.
- C++ is linked statically on Windows, so a different MinGW's DLLs on the PATH can't crash it.
- Authoring: `npm run new <slug> -- --checker --hints`; `npm run build` checks the checker against
  the reference and stress-tests through it.

## 0.2.0 (2026-11-22)

- Stress Test: compare your solution with a brute force on random inputs from a generator; the first
  failing input is saved as a test. Templates for `gen` and `brute` are offered.
- Run history per problem, best time in the sidebar, Show Run History.
- Compiled programs are reused until the file changes (Run Tests, Custom Input, Stress Test).
- Java gets 2x the time limit by default; `timeMultipliers` in meta.json and the `dsaDrill.timeMultipliers` setting.
- Compiler warnings, and the line a Python/Java solution crashed on, show in the Problems panel.
- Updating a problem's tests keeps test files you added to `.data/`.

## 0.1.0 (2026-11-22)

First release.

- Run Tests for C++, Java and Python with a results panel, CodeLens and compile errors in the Problems panel.
- Run Custom Input.
- Problems sidebar: problems from a GitHub repo, grouped by difficulty, downloaded with a starter file.
- Test updates are detected and fetched without touching your solution.
- Solved tracking (synced with Settings Sync) and a filter by tag / hide solved.
