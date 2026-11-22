# Two Sum

You are given an array of `n` integers and a target `t`. Find two **different** positions
`i < j` such that `a_i + a_j = t`.

If several pairs work, print the one with the **smallest `j`**. If there is still a tie, print
the one with the smallest `i`.

## Input

The first line contains `n` and `t`.
The second line contains `n` integers `a_1, a_2, ..., a_n`.

## Output

Print `i j` (1-based positions), or `-1` if no such pair exists.

## Constraints

- `2 ≤ n ≤ 2·10^5`
- `|a_i| ≤ 10^9`, `|t| ≤ 2·10^9`

`a_i + a_j` can be larger than a 32-bit integer can hold.

## Example 1

Input:

```
4 9
2 7 11 15
```

Output:

```
1 2
```

## Example 2

Input:

```
4 10
1 6 4 9
```

Output:

```
2 3
```

Both `1 + 9` (positions 1 and 4) and `6 + 4` (positions 2 and 3) make 10. The second pair
ends earlier, so it is the answer.

## Example 3

Input:

```
3 10
5 1 2
```

Output:

```
-1
```

The same position cannot be used twice, so `5 + 5` does not count.
