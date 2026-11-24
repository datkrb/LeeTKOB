// M3: Sandbox must enforce a wall-clock limit that kills the entire container, not only the main process.
// Spawns a sleeping child process and sleeps in the parent as well.
// Expected in hardened sandbox: container is killed well before 60 seconds elapse.
#include <chrono>
#include <iostream>
#include <thread>
#include <unistd.h>

int main() {
  pid_t pid = fork();
  if (pid == 0) {
    std::this_thread::sleep_for(std::chrono::seconds(60));
    return 0;
  }
  std::this_thread::sleep_for(std::chrono::seconds(60));
  std::cout << "ATTACK_SUCCEEDED: survived 60s wall-clock\n";
  return 0;
}

