// M2: Sandbox must enforce a CPU time limit.
// Expected in hardened sandbox: process is killed by CPU limit (SIGXCPU / SIGKILL) or timeout.
#include <cstdint>
#include <iostream>

int main() {
  volatile std::uint64_t x = 1;
  while (true) {
    x = x * 6364136223846793005ULL + 1442695040888963407ULL;
  }
  std::cout << "ATTACK_SUCCEEDED: " << x << '\n';
  return 0;
}

