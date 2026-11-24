# Sandbox Attack Submissions (M1–M9)

Nine C++ attack programs corresponding to the nine sandbox minimums in the LeeTKOB class brief and PA#3 rubric:

| File | Minimum | Expected behavior in hardened sandbox |
|---|---|---|
| `m1_network.cpp` | M1: No network | Outbound TCP `connect()` to `8.8.8.8:53` fails (`ENETUNREACH`/`EACCES`), exits non-zero. |
| `m2_cpu_limit.cpp` | M2: CPU time limit | Tight `volatile` loop killed by CPU limit (`SIGXCPU`/`SIGKILL`). |
| `m3_wall_clock.cpp` | M3: Wall-clock kills container | Forks child + sleeps 60s; container is force-killed before 60s. |
| `m4_memory_limit.cpp` | M4: Memory + swap limit | Allocates 1 GiB, writes & reads back every page; killed by OOM or `bad_alloc`. |
| `m5_process_limit.cpp` | M5: Process limit | Spawns 200 concurrent children; `fork()` fails with `EAGAIN` under `--pids-limit`. |
| `m6_output_limit.cpp` | M6: Output size limit | Writes 16 MiB to stdout; truncated or killed by output limit. |
| `m7_non_root.cpp` | M7: Non-root user | `getuid()/geteuid() != 0` and `/etc` is not writable; exits non-zero. |
| `m8_no_host_or_docker_sock.cpp` | M8: No host mounts / Docker socket | `/var/run/docker.sock` absent and `/etc/shadow` unreadable; exits non-zero. |
| `m9_no_secrets.cpp` | M9: No secrets | No `LLM_API_KEY`/`GEMINI_API_KEY`, no `/proc/self/environ` leak, no `.env` file or `#include`. |

