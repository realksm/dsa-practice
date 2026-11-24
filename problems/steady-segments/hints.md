# Hints

## "Exactly" is hard, "at most" is easy

If a segment satisfies "at most `k` distinct values and spread `≤ D`", so does every shorter
segment inside it. Conditions like that are what sliding windows need. "Exactly `K`" isn't one:
shrinking can drop you below `K`. But

```
exactly(K) = atMost(K) - atMost(K - 1)
```

where `atMost(k)` counts segments with at most `k` distinct values and spread at most `D`.

## One window per right end

For `atMost(k)`, move the right end `r` from left to right. Keep the smallest `l` such that
`a_l..a_r` is still fine; it never moves left when `r` grows. Every segment ending at `r` and
starting in `l..r` counts, so add `r - l + 1`. Each index enters and leaves the window once:
O(n) per call, instead of O(n²) for trying every segment.

## Knowing the window's distinct count and its spread

- **Distinct values:** a count per value (a hash map, or compress the values to `0..n-1` and use
  an array). The number of distinct values changes when a count goes 0 → 1 or 1 → 0.
- **Max and min:** two **monotonic deques** of indices. The max-deque keeps values decreasing
  from front to back: before pushing `r`, pop every back index whose value is `≤ a_r`. Its front
  is the window's maximum. When `l` moves past the front index, pop it. Same for the min,
  with the comparison flipped.

Shrink (`l++`) while there are more than `k` distinct values **or** max - min `> D`.

## The details that make it right

- `atMost(0)` is 0 (no segment has zero values), so `K = 1` works without a special case.
- `max - min` can reach `2·10^9`, and the answer up to `n(n+1)/2 ≈ 2·10^10`: use 64-bit integers.
- Reset the counts and deques between the two calls.
- `K` larger than the number of distinct values in the whole array gives 0.
