#include <iostream>
using namespace std;

long long modPowRec(long long a, long long b, long long m) {
    if (m == 1) return 0;
    if (b == 0) return 1 % m;
    long long half = modPowRec(a % m, b / 2, m);
    long long sq = (half * half) % m;
    return (b % 2 == 1) ? (sq * (a % m)) % m : sq;
}

int main() {
    int t;
    if (!(cin >> t)) return 0;
    while (t--) {
        long long a, b, m;
        cin >> a >> b >> m;
        cout << modPowRec(a, b, m) << "\n";
    }
    return 0;
}
