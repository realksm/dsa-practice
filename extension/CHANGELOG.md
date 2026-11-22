# Changelog

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
