# Painted Grid Sums

A grid has `n` rows and `m` columns, and every cell starts at 0. Then `Q` paint operations
are applied. Operation `r1 c1 r2 c2 v` adds `v` to every cell in rows `r1..r2` and columns
`c1..c2` (1-based, inclusive). `v` can be negative.

After all operations, count the **submatrices** (rectangles of whole cells, any size from 1×1
to the full grid) whose cells add up to **exactly `T`**.

## Input

The first line contains `n`, `m`, `Q` and `T`.
Each of the next `Q` lines contains `r1 c1 r2 c2 v`.

## Output

Print one integer: the number of submatrices with sum `T`.

## Constraints

- `1 ≤ n, m` and `n·m ≤ 62500` (the grid can be 250×250, but also 1×62500 or 62500×1)
- `0 ≤ Q ≤ 10^5`
- `1 ≤ r1 ≤ r2 ≤ n`, `1 ≤ c1 ≤ c2 ≤ m`
- `|v| ≤ 10^6`
- `|T| ≤ 10^18`

A cell can reach `10^11` and a submatrix `10^16`: use 64-bit integers.

## Example 1

Input:

```
2 3 2 2
1 1 2 2 1
2 2 2 3 1
```

Output:

```
4
```

The grid ends up as

```
1 1 0
1 2 1
```

The submatrices with sum 2 are: row 1 columns 1–2, row 1 columns 1–3, row 2 column 2, and
column 1 rows 1–2.

## Example 2

Input:

```
3 3 1 0
2 2 2 2 5
```

Output:

```
20
```

A 3×3 grid has 36 submatrices. The 16 that contain the middle cell add up to 5; the other
20 add up to 0.

## Example 3

Input:

```
2 2 2 0
1 1 2 2 3
1 2 2 2 -6
```

Output:

```
3
```

The grid is `3 -3` over `3 -3`. Each row adds up to 0, and so does the whole grid.
