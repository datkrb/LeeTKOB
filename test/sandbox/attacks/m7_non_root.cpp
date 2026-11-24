// M7: Sandbox must run as a non-root user.
// Expected in hardened sandbox: getuid()/geteuid() != 0 and writing /etc fails -> exit 1.
#include <cerrno>
#include <cstring>
#include <fstream>
#include <iostream>
#include <unistd.h>

int main() {
  uid_t uid = getuid();
  uid_t euid = geteuid();
  if (uid == 0 || euid == 0) {
    std::cout << "ATTACK_SUCCEEDED: running as root (uid=" << uid << ", euid=" << euid << ")\n";
    return 0;
  }

  std::ofstream probe("/etc/leetkob_root_probe");
  if (probe.is_open()) {
    probe << "pwned\n";
    std::cout << "ATTACK_SUCCEEDED: /etc is writable\n";
    return 0;
  }

  std::cerr << "BLOCKED: non-root uid=" << uid << " euid=" << euid
            << ", /etc write error=" << std::strerror(errno) << '\n';
  return 1;
}

