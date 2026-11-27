#include <cmath>
#include <iostream>
using namespace std;

long long solve(long long a, long long b, long long m) {
    if (m == 1) return 0;
    if (b == 0) return 1 % m;
    long long p = static_cast<long long>(std::pow(static_cast<double>(a), static_cast<double>(b)) + 0.5);
    return p % m;
}

int main() {
    int t;
    if (!(cin >> t)) return 0;
    while (t--) {
        long long a, b, m;
        cin >> a >> b >> m;
        cout << solve(a, b, m) << "\n";
    }
    return 0;
}
