#include <bits/stdc++.h>
using namespace std;

// Kadane's algorithm, O(n)
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;

    long long best = 0;   // BUG: should start at a[0] - wrong when every number is negative
    long long cur = 0;
    for (long long x : a) {
        cur = max(x, cur + x);
        best = max(best, cur);
    }
    cout << best << "\n";
}
