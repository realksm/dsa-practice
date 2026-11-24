# Hints

## Paint the grid without painting every cell

Adding `v` to a whole rectangle cell by cell can cost `n·m` per operation: `10^5 · 62500` is far
too much. Use a **2D difference array** instead: for each operation do four updates,

```
d[r1][c1] += v      d[r1][c2+1] -= v
d[r2+1][c1] -= v    d[r2+1][c2+1] += v
```

and at the end take 2D prefix sums of `d`
(`g[i][j] = d[i][j] + g[i-1][j] + g[i][j-1] - g[i-1][j-1]`). That gives every cell's value in
O(Q + n·m).

## Squash two rows into one

Trying every rectangle is O(n²m²), too slow even with a 2D prefix table to sum each one in O(1).
Fix the top row `a` and the bottom row `b` of the rectangle instead. Each column then
contributes one number, the sum of its cells from row `a` to row `b`, and the rectangles between
those rows are exactly the **subarrays** of that one row of column sums. When `b` moves down by
one, add row `b` to the column sums: O(m) per pair of rows.

## Counting subarrays with sum T

In one row of column sums, keep the running prefix sum `p`. A subarray ending here has sum `T`
exactly when an earlier prefix (including the empty one, 0) was `p - T`. Keep a hash map from
prefix value to how many times it appeared: look up `p - T`, add its count to the answer, then
record `p`. Negative values break the usual sliding-window trick; this works with any signs.

## The details that make it right

- Loop over pairs of the **shorter** side. On a 62500×1 grid, pairs of rows would be ~2·10^9;
  pairs of columns are just 1. Swap the roles (transpose) when `n > m`. The worst case is then
  250×250: about `31 000 · 250 ≈ 8·10^6` hash-map steps.
- Put the empty prefix 0 in the map before each row, so subarrays starting at column 1 count.
- Values, prefix sums, `T` and the answer all need 64-bit integers. The answer can be large:
  with `T = 0` and no paint, every one of the ~10^9 submatrices counts.
- `Q = 0` is allowed: the grid is all zeros.
