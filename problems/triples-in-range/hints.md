# Hints

## Positions don't matter as much as they seem

The answer only depends on which three *elements* you pick, not on where they stand: reordering
the array maps triples `i < j < k` one-to-one onto triples of the reordered array. So you are
free to **sort** it first, and sorted arrays are where two pointers shine.

## Turn a range into two "at most" counts

Counting sums in `[L, R]` directly is awkward. Instead write a function `atMost(X)`: the number
of triples with sum `≤ X`. Then the answer is `atMost(R) - atMost(L - 1)`.

## Counting pairs with two pointers

Fix the smallest element `a_i` of the triple. Now count pairs `j < k` after `i` with
`a_j + a_k ≤ X - a_i`. Start `j = i + 1` and `k = n` at the two ends:

- if `a_i + a_j + a_k ≤ X`, then `j` also works with **every** `k'` between `j + 1` and `k`
  (the array is sorted, so those sums are no larger): add `k - j` and move `j` right;
- otherwise the sum is too big: move `k` left.

Each step moves a pointer, so one `i` costs O(n) and the whole thing O(n²). That's about
`4.5·10^6` steps per call, fast enough. Trying every triple, O(n³), is not.

## The details that make it right

- Duplicates need no special care: you are counting positions, and the pointers never skip one.
- Sums reach `3·10^9` and the answer reaches `C(3000, 3) ≈ 4.5·10^9`: use 64-bit integers
  for sums, bounds and the count. `L - 1` must not overflow either.
- When `L` is larger than every possible sum, both calls give the same number and the answer is 0.
