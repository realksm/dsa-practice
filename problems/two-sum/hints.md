# Hints

## Why trying every pair is too slow

Checking every pair `i < j` takes about `n²/2` steps: with `n = 2·10^5` that is 2·10^10, far
more than fits in a second. You need to find the partner of each number without scanning
the whole array again.

## Look at it from the right end of the pair

Go through `j = 1, 2, …, n` in order. For a fixed `j`, the question becomes: has the value
`t - a_j` already appeared at some position before `j`? The first `j` where the answer is yes
is the pair with the smallest `j`.

## Remember what you've seen

Keep a hash map from a value to the position where it first appeared. Each step is then one
lookup (`t - a_j`) and one insert (`a_j`), so the whole scan is O(n).

## The details that make it right

- Look up `t - a_j` **before** inserting `a_j`, so a number can't pair with itself (Example 3).
- If a value repeats, keep its **first** position: that gives the smallest `i` for this `j`.
- `t - a_j` can reach about 3·10^9: use 64-bit integers (`long long` / `long`).
