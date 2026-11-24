// M8: Sandbox must have no host mounts and no Docker socket.
// Expected in hardened sandbox: /var/run/docker.sock and host files are absent/unreadable -> exit 1.
#include <fstream>
#include <iostream>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

int main() {
  if (access("/var/run/docker.sock", F_OK) == 0) {
    std::cout << "ATTACK_SUCCEEDED: /var/run/docker.sock is present\n";
    return 0;
  }

  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd >= 0) {
    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    const char* sockPath = "/var/run/docker.sock";
    for (int i = 0; sockPath[i] != '\0'; ++i) addr.sun_path[i] = sockPath[i];
    if (connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
      close(fd);
      std::cout << "ATTACK_SUCCEEDED: connected to docker.sock\n";
      return 0;
    }
    close(fd);
  }

  std::ifstream shadow("/etc/shadow");
  if (shadow.is_open()) {
    std::cout << "ATTACK_SUCCEEDED: /etc/shadow is readable\n";
    return 0;
  }

  std::cerr << "BLOCKED: no docker.sock and no sensitive host mounts\n";
  return 1;
}

