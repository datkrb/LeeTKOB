// M4: Sandbox must enforce a memory limit (swap included).
// Allocates 1 GiB in chunks, writes to every page, and reads back into a volatile sum
// so the compiler (-O2) cannot optimize away the allocation.
// Expected in hardened sandbox (< 1 GiB limit): killed by OOM (SIGKILL / 137) or std::bad_alloc.
#include <cstdint>
#include <iostream>
#include <new>
#include <vector>

int main() {
  constexpr std::size_t kChunkBytes = 64ULL * 1024 * 1024;  // 64 MiB
  constexpr std::size_t kChunks = 16;                       // 1 GiB total
  constexpr std::size_t kPageStride = 4096;

  std::vector<std::vector<std::uint8_t>> blocks;
  volatile std::uint64_t checksum = 0;

  try {
    for (std::size_t c = 0; c < kChunks; ++c) {
      std::vector<std::uint8_t> buf(kChunkBytes);
      for (std::size_t i = 0; i < kChunkBytes; i += kPageStride) {
        buf[i] = static_cast<std::uint8_t>((c + i) & 0xFF);
      }
      for (std::size_t i = 0; i < kChunkBytes; i += kPageStride) {
        checksum += buf[i];
      }
      blocks.push_back(std::move(buf));
    }
  } catch (const std::bad_alloc&) {
    std::cerr << "BLOCKED: std::bad_alloc caught\n";
    return 1;
  }

  std::cout << "ATTACK_SUCCEEDED: allocated and read 1 GiB, checksum=" << checksum << '\n';
  return 0;
}

