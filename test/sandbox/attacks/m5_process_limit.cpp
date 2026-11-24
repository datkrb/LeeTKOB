// M5: Sandbox must enforce a process/PIDs limit.
// Attempts to spawn 200 concurrent child processes (bounded so it is safe to test).
// Expected in hardened sandbox (e.g. --pids-limit=32 or 64): fork() fails with EAGAIN -> exit 1.
#include <cerrno>
#include <cstring>
#include <iostream>
#include <sys/wait.h>
#include <unistd.h>
#include <vector>

int main() {
  constexpr int kTargetProcs = 200;
  std::vector<pid_t> children;
  children.reserve(kTargetProcs);

  for (int i = 0; i < kTargetProcs; ++i) {
    pid_t pid = fork();
    if (pid < 0) {
      std::cerr << "BLOCKED: fork failed at " << i << ": " << std::strerror(errno) << '\n';
      for (pid_t c : children) waitpid(c, nullptr, 0);
      return 1;
    }
    if (pid == 0) {
      usleep(200000);
      _exit(0);
    }
    children.push_back(pid);
  }

  for (pid_t c : children) waitpid(c, nullptr, 0);
  std::cout << "ATTACK_SUCCEEDED: spawned " << kTargetProcs << " concurrent processes\n";
  return 0;
}

