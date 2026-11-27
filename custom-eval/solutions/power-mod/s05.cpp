#include <iostream>
using namespace std;

long long binary_exp(long long a, long long b, long long m) {
    if (m == 1) return 0;
    long long res = 1 % m;
    for (long long i = 0; i < b; i++) {
        res = (res * (a % m)) % m;
    }
    return res;
}

int main() {
    int t;
    if (!(cin >> t)) return 0;
    while (t--) {
        long long a, b, m;
        cin >> a >> b >> m;
        cout << binary_exp(a, b, m) << "\n";
    }
    return 0;
}
