# Maximum Subarray Sum

You are given an array of `n` integers. Find the largest possible sum of a **non-empty**
contiguous subarray.

## Input

The first line contains `n`.
The second line contains `n` integers `a_1, a_2, ..., a_n`.

## Output

Print one integer: the largest sum of `a_l + a_(l+1) + ... + a_r` over all `1 ≤ l ≤ r ≤ n`.

## Constraints

- `1 ≤ n ≤ 2·10^5`
- `|a_i| ≤ 10^9`

The answer can be as large as `2·10^14`, so it does not fit in a 32-bit integer.

## Example

Input:

```
5
1 -2 3 4 -1
```

Output:

```
7
```

The best subarray is `3 4`.

## Note

The subarray must contain at least one element. If every number is negative, the answer is
the largest single number.
