# Steady Segments

A segment (contiguous subarray) `a_l, a_{l+1}, ..., a_r` is **steady** if

- it contains **exactly `K` distinct values**, and
- its largest value minus its smallest value is **at most `D`**.

Count the steady segments of the array.

## Input

The first line contains `n`, `K` and `D`.
The second line contains `n` integers `a_1, a_2, ..., a_n`.

## Output

Print one integer: the number of steady segments.

## Constraints

- `1 ≤ n ≤ 2·10^5`
- `1 ≤ K ≤ n`
- `0 ≤ D ≤ 2·10^9`
- `|a_i| ≤ 10^9`

The difference between two values, `D` and the answer can be larger than a 32-bit integer can hold.

## Example 1

Input:

```
6 2 2
1 3 2 2 5 4
```

Output:

```
4
```

The steady segments are `[1 3]`, `[3 2]`, `[3 2 2]` and `[5 4]`. `[1 3 2]` has three distinct
values, and `[2 2 5]` spreads over 3, more than `D = 2`.

## Example 2

Input:

```
5 1 0
7 7 7 2 7
```

Output:

```
8
```

With `K = 1` and `D = 0` a segment is steady when all its values are equal: six inside the
first run of 7s, plus `[2]` and the last `[7]`.

## Example 3

Input:

```
4 2 10
-5 5 -5 5
```

Output:

```
6
```

Every segment of length at least 2 has the two values -5 and 5, and `5 - (-5) = 10 ≤ D`.
