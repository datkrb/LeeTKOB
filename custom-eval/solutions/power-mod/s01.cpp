#include <iostream>
using namespace std;

long long modPow(long long a, long long b, long long m) {
    if (m == 1) return 0;
    long long res = 1 % m;
    a %= m;
    while (b > 0) {
        if (b & 1) res = (res * a) % m;
        a = (a * a) % m;
        b >>= 1;
    }
    return res;
}

int main() {
    int t;
    if (!(cin >> t)) return 0;
    while (t--) {
        long long a, b, m;
        cin >> a >> b >> m;
        cout << modPow(a, b, m) << "\n";
    }
    return 0;
}
