#!/bin/sh
set -eu

CPU_LIMIT_SEC="${1:-2}"

IFS= read -r CODE_B64 || exit 2
IFS= read -r INPUT_B64 || INPUT_B64=""

printf '%s' "$CODE_B64" | base64 -d > /work/main.cpp
printf '%s' "$INPUT_B64" | base64 -d > /work/in.txt

if ! g++ -std=c++17 -O2 /work/main.cpp -o /work/main 2>/work/compile.err; then
  printf '__LEETKOB_COMPILE_ERROR__\n' >&2
  head -c 65536 /work/compile.err >&2
  exit 100
fi

ulimit -t "$CPU_LIMIT_SEC"
exec /work/main < /work/in.txt
