// M1: Sandbox must have no network access.
// Expected in hardened sandbox: socket/connect fails (ENETUNREACH / EACCES / timeout) -> exit 1.
// If connect() succeeds -> prints ATTACK_SUCCEEDED and exits 0.
#include <arpa/inet.h>
#include <cerrno>
#include <cstring>
#include <iostream>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

int main() {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    std::cerr << "BLOCKED: socket failed: " << std::strerror(errno) << '\n';
    return 1;
  }

  timeval tv{2, 0};
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(53);
  inet_pton(AF_INET, "8.8.8.8", &addr.sin_addr);

  if (connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
    close(fd);
    std::cout << "ATTACK_SUCCEEDED: outbound TCP connection succeeded\n";
    return 0;
  }

  std::cerr << "BLOCKED: connect failed: " << std::strerror(errno) << '\n';
  close(fd);
  return 1;
}

