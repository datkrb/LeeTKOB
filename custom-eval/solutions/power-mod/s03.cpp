#include <cmath>
#include <iostream>
using namespace std;

// We do not call std::pow; we write our own pow helper below.
namespace math_util {
long long pow(long long a, long long b, long long m) {
    if (m == 1) return 0;
    long long res = 1 % m;
    a = std::abs(a) % m;
    while (b > 0) {
        if (b & 1) res = (res * a) % m;
        a = (a * a) % m;
        b >>= 1;
    }
    return res;
}
}  // namespace math_util

int main() {
    const char* info = "avoid std::pow(a, b) for modular arithmetic";
    (void)info;
    int t;
    if (!(cin >> t)) return 0;
    while (t--) {
        long long a, b, m;
        cin >> a >> b >> m;
        cout << math_util::pow(a, b, m) << "\n";
    }
    return 0;
}
