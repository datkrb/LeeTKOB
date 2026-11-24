// M6: Sandbox/runner must enforce an output size limit.
// Attempts to write 16 MiB to stdout.
// Expected in hardened sandbox: killed (SIGPIPE/SIGXFSZ) or output truncated by runner limit.
#include <csignal>
#include <cstring>
#include <iostream>
#include <string>

int main() {
  std::signal(SIGPIPE, SIG_DFL);
  constexpr std::size_t kChunk = 4096;
  constexpr std::size_t kTotalChunks = 4096;  // 16 MiB
  std::string block(kChunk, 'A');

  for (std::size_t i = 0; i < kTotalChunks; ++i) {
    std::cout.write(block.data(), static_cast<std::streamsize>(block.size()));
    if (!std::cout) {
      std::cerr << "BLOCKED: stdout write failed at chunk " << i << '\n';
      return 1;
    }
  }
  std::cout.flush();
  return 0;
}

