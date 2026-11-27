import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDockerRunArgs, sanitizeHostEnv, tokensEqual } from '../../src/sandbox.js';

test('buildDockerRunArgs enforces all Docker-level sandbox minimums with zero mounts or secrets', () => {
  const args = buildDockerRunArgs({
    containerName: 'leetkob-sbx-test',
    image: 'leetkob-sandbox',
    memoryMb: 256,
    pidsLimit: 64,
    cpuLimitSec: 2,
  });

  const joined = args.join(' ');
  // M1: no network
  assert.equal(joined.includes('--network none'), true);
  // M4: memory limit with swap disabled (memory == memory-swap)
  assert.equal(joined.includes('--memory 256m'), true);
  assert.equal(joined.includes('--memory-swap 256m'), true);
  // M5: process limit
  assert.equal(joined.includes('--pids-limit 64'), true);
  // M7: non-root user + dropped capabilities + no-new-privileges
  assert.equal(joined.includes('--user 10001:10001'), true);
  assert.equal(joined.includes('--cap-drop ALL'), true);
  assert.equal(joined.includes('no-new-privileges:true'), true);
  // M8: read-only rootfs, zero bind mounts, zero docker.sock, zero --privileged
  assert.equal(joined.includes('--read-only'), true);
  assert.equal(args.includes('-v'), false);
  assert.equal(args.includes('--volume'), false);
  assert.equal(args.includes('--privileged'), false);
  assert.equal(joined.includes('docker.sock'), false);
  // M9: zero env flags or env-file
  assert.equal(args.includes('-e'), false);
  assert.equal(args.includes('--env'), false);
  assert.equal(args.includes('--env-file'), false);
  assert.equal(joined.includes('LLM_API_KEY'), false);
});

test('sanitizeHostEnv strips all API key variables from the docker subprocess environment', () => {
  const clean = sanitizeHostEnv({
    PATH: '/usr/bin',
    HOME: '/home/runner',
    LLM_API_KEY: 'secret-value',
    GEMINI_API_KEY: 'secret-value',
    MODEL_API_KEY: 'secret-value',
    OPENAI_API_KEY: 'secret-value',
    API_KEY: 'secret-value',
    CUSTOM_SECRET_TOKEN: 'secret-value',
  });

  assert.equal(clean.PATH, '/usr/bin');
  assert.equal(clean.LLM_API_KEY, undefined);
  assert.equal(clean.GEMINI_API_KEY, undefined);
  assert.equal(clean.MODEL_API_KEY, undefined);
  assert.equal(clean.OPENAI_API_KEY, undefined);
  assert.equal(clean.API_KEY, undefined);
  assert.equal(clean.CUSTOM_SECRET_TOKEN, undefined);
});

test('tokensEqual compares outputs token-by-token ignoring whitespace differences', () => {
  assert.equal(tokensEqual('1 2 3\n', '  1   2\n3  '), true);
  assert.equal(tokensEqual('1 2 4\n', '1 2 3\n'), false);
  assert.equal(tokensEqual('', '   \n\t '), true);
});
