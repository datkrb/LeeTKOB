import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInSandbox, judgeSubmissionInSandbox } from '../../src/sandbox.js';

const ATTACKS_DIR = resolve('test/sandbox/attacks');

/** @param {string} filename */
function readAttack(filename) {
  return readFileSync(resolve(ATTACKS_DIR, filename), 'utf8');
}

test('compliant C++17 solution (including <bits/stdc++.h>) compiles and passes tests inside sandbox', async () => {
  const code = readFileSync(resolve('leetkob-eval/solutions/sort-merge/s01.cpp'), 'utf8');
  const input = readFileSync(resolve('leetkob-eval/problems/sort-merge/tests/01.in'), 'utf8');
  const expectedOutput = readFileSync(
    resolve('leetkob-eval/problems/sort-merge/tests/01.out'),
    'utf8',
  );

  const res = await judgeSubmissionInSandbox({
    code,
    tests: [{ id: 1, name: '01', input, expectedOutput }],
  });

  assert.equal(res.status, 'accepted', `expected accepted, got ${JSON.stringify(res)}`);
});

test('M1: no network access blocks outbound TCP connection', async () => {
  const res = await runInSandbox({ code: readAttack('m1_network.cpp'), wallClockMs: 10000 });
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.notEqual(res.exitCode, 0);
});

test('M2: CPU time limit kills infinite tight loop', async () => {
  const res = await runInSandbox({
    code: readAttack('m2_cpu_limit.cpp'),
    cpuLimitSec: 2,
    wallClockMs: 12000,
  });
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.notEqual(res.exitCode, 0);
});

test('M3: wall-clock limit kills the entire container including forked sleeping child', async () => {
  const started = Date.now();
  const res = await runInSandbox({
    code: readAttack('m3_wall_clock.cpp'),
    cpuLimitSec: 5,
    wallClockMs: 5000,
  });
  const elapsed = Date.now() - started;
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.equal(res.timedOut, true);
  assert.ok(elapsed < 20000, `container should be killed well before 60s, took ${elapsed}ms`);
});

test('M4: memory + swap limit stops 1 GiB allocation that reads back every page', async () => {
  const res = await runInSandbox({
    code: readAttack('m4_memory_limit.cpp'),
    memoryMb: 256,
    wallClockMs: 12000,
  });
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.notEqual(res.exitCode, 0);
});

test('M5: process limit blocks spawning 200 concurrent children', async () => {
  const res = await runInSandbox({
    code: readAttack('m5_process_limit.cpp'),
    pidsLimit: 64,
    wallClockMs: 12000,
  });
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.notEqual(res.exitCode, 0);
});

test('M6: output size limit stops 16 MiB stdout flood', async () => {
  const maxOutputBytes = 256 * 1024;
  const res = await runInSandbox({
    code: readAttack('m6_output_limit.cpp'),
    maxOutputBytes,
    wallClockMs: 12000,
  });
  assert.equal(res.compileError, false);
  assert.equal(res.outputExceeded, true);
  assert.ok(
    Buffer.byteLength(res.stdout, 'utf8') <= maxOutputBytes,
    'captured stdout must not exceed maxOutputBytes',
  );
});

test('M7: sandbox runs as a non-root user and cannot write /etc', async () => {
  const res = await runInSandbox({ code: readAttack('m7_non_root.cpp'), wallClockMs: 10000 });
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.notEqual(res.exitCode, 0);
});

test('M8: sandbox has no Docker socket and no sensitive host mounts', async () => {
  const res = await runInSandbox({
    code: readAttack('m8_no_host_or_docker_sock.cpp'),
    wallClockMs: 10000,
  });
  assert.equal(res.compileError, false);
  assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
  assert.notEqual(res.exitCode, 0);
});

test('M9: sandbox receives no secrets even when LLM_API_KEY is set on the host process', async () => {
  const prev = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'AIzaSyFakeSecretMustNeverEnterSandbox';
  try {
    const res = await runInSandbox({ code: readAttack('m9_no_secrets.cpp'), wallClockMs: 10000 });
    assert.equal(res.compileError, false);
    assert.equal(res.stdout.includes('ATTACK_SUCCEEDED'), false);
    assert.notEqual(res.exitCode, 0);
  } finally {
    if (prev === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = prev;
  }
});
