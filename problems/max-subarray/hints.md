# Hints

## Why trying every subarray is too slow

There are about `n²/2` subarrays; with `n = 2·10^5` that is 2·10^10 sums, far too many for one
second (and summing each one from scratch is worse). Look for a way to reuse work from one
position to the next.

## Fix where the subarray ends

For each position `r`, let `best_end(r)` be the largest sum of a subarray that **ends exactly at
`r`**. The answer is the largest `best_end(r)` over all `r`. How does `best_end(r)` relate to
`best_end(r - 1)`?

## Extend or start over

A subarray ending at `r` either is just `a_r`, or extends the best one ending at `r - 1`. So
`best_end(r) = max(a_r, best_end(r - 1) + a_r)`: if what came before is negative, drop it and
start again at `r`. One pass, O(n) time and O(1) memory (this is Kadane's algorithm).

## The details that make it right

- The subarray can't be empty: start the answer at `a_1`, not at 0, or an all-negative array
  wrongly gives 0.
- Sums reach about 2·10^14: keep them in 64-bit integers (`long long` / `long`).
