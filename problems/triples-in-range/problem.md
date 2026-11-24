# Triples in a Range

You are given an array of `n` integers and two numbers `L ≤ R`. Count the triples of
positions `i < j < k` with

```
L ≤ a_i + a_j + a_k ≤ R
```

Triples are told apart by their **positions**, so equal values at different positions make
different triples.

## Input

The first line contains `n`, `L` and `R`.
The second line contains `n` integers `a_1, a_2, ..., a_n`.

## Output

Print one integer: the number of such triples.

## Constraints

- `3 ≤ n ≤ 3000`
- `|a_i| ≤ 10^9`
- `-3·10^9 ≤ L ≤ R ≤ 3·10^9`

A sum of three values, `L`, `R` and the answer can all be larger than a 32-bit integer can hold.

## Example 1

Input:

```
5 6 9
1 2 3 4 5
```

Output:

```
6
```

The ten triples have sums 6, 7, 8, 8, 9, 10, 9, 10, 11, 12. Six of them are between 6 and 9.

## Example 2

Input:

```
4 0 0
-1 0 1 0
```

Output:

```
2
```

Positions (1, 2, 3) and (1, 3, 4) both give `-1 + 0 + 1 = 0`. They use different zeros, so
both count.

## Example 3

Input:

```
3 100 200
1 2 3
```

Output:

```
0
```
