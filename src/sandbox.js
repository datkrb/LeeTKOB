// Hardened Docker C++17 sandbox runner for LeeTKOB (meets minimums M1-M9).
// Compiles and executes untrusted student code inside an isolated container with zero host mounts,
// no network, non-root user, CPU/wall-clock/memory+swap/PID/output limits, and zero secrets.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { clearTimeout as clearTimer, setTimeout as setTimer } from 'node:timers';

export const DEFAULT_SANDBOX_IMAGE = 'leetkob-sandbox';

const COMPILE_ERR_MARKER = '__LEETKOB_COMPILE_ERROR__';
const SECRET_ENV_RE =
  /(?:key|secret|token|password|passwd|credential|gemini|openai|anthropic|llm_)/i;

/**
 * Strips any secret/API-key environment variables before spawning `docker`.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function sanitizeHostEnv(env = process.env) {
  /** @type {Record<string, string>} */
  const clean = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (SECRET_ENV_RE.test(k)) continue;
    clean[k] = v;
  }
  return clean;
}

/**
 * Builds hardened `docker run` arguments meeting minimums M1-M9.
 * Never passes `-v`, `--volume`, `--privileged`, `-e`, `--env-file`, or `docker.sock`.
 * @param {{
 *   containerName: string,
 *   image?: string,
 *   memoryMb?: number,
 *   pidsLimit?: number,
 *   cpuLimitSec?: number
 * }} options
 * @returns {string[]}
 */
export function buildDockerRunArgs({
  containerName,
  image = process.env.SANDBOX_IMAGE || DEFAULT_SANDBOX_IMAGE,
  memoryMb = 256,
  pidsLimit = 64,
  cpuLimitSec = 2,
}) {
  return [
    'run',
    '--rm',
    '-i',
    '--name',
    containerName,
    '--network',
    'none',
    '--cpus',
    '1',
    '--memory',
    `${memoryMb}m`,
    '--memory-swap',
    `${memoryMb}m`,
    '--pids-limit',
    String(pidsLimit),
    '--user',
    '10001:10001',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--tmpfs',
    '/work:rw,exec,nosuid,size=64m,uid=10001,gid=10001',
    image,
    String(cpuLimitSec),
  ];
}

/**
 * Compares two outputs token-by-token, ignoring whitespace differences.
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
export function tokensEqual(actual, expected) {
  const aTrim = String(actual ?? '').trim();
  const eTrim = String(expected ?? '').trim();
  if (aTrim === '' && eTrim === '') return true;
  if (aTrim === '' || eTrim === '') return false;
  const a = aTrim.split(/\s+/);
  const e = eTrim.split(/\s+/);
  if (a.length !== e.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== e[i]) return false;
  }
  return true;
}

/**
 * Forcefully kills and removes a sandbox container by name (M3 wall-clock / M6 output limit).
 * @param {string} containerName
 * @param {Record<string, string>} cleanEnv
 */
function forceRemoveContainer(containerName, cleanEnv) {
  const killer = spawn('docker', ['rm', '-f', containerName], {
    env: cleanEnv,
    stdio: 'ignore',
  });
  killer.on('error', () => {});
  killer.unref();
}

/**
 * Compiles and executes a C++17 program inside a hardened Docker sandbox container.
 * @param {{
 *   code: string,
 *   stdin?: string,
 *   image?: string,
 *   memoryMb?: number,
 *   pidsLimit?: number,
 *   cpuLimitSec?: number,
 *   wallClockMs?: number,
 *   maxOutputBytes?: number
 * }} options
 * @returns {Promise<{
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 *   timedOut: boolean,
 *   outputExceeded: boolean,
 *   compileError: boolean
 * }>}
 */
export function runInSandbox({
  code,
  stdin = '',
  image,
  memoryMb = 256,
  pidsLimit = 64,
  cpuLimitSec = 2,
  wallClockMs = 10000,
  maxOutputBytes = 1024 * 1024,
}) {
  const containerName = `leetkob-sbx-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const cleanEnv = sanitizeHostEnv(process.env);
  const args = buildDockerRunArgs({ containerName, image, memoryMb, pidsLimit, cpuLimitSec });

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('docker', args, {
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    /** @type {Buffer[]} */
    const stdoutChunks = [];
    let stdoutBytes = 0;
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let stderrBytes = 0;
    const maxStderrBytes = 65536;

    let timedOut = false;
    let outputExceeded = false;
    let killed = false;

    const killAll = () => {
      if (killed) return;
      killed = true;
      forceRemoveContainer(containerName, cleanEnv);
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore if already exited
      }
    };

    const timer = setTimer(() => {
      timedOut = true;
      killAll();
    }, wallClockMs);

    child.stdout.on('data', (/** @type {Buffer} */ chunk) => {
      if (outputExceeded) return;
      if (stdoutBytes + chunk.length > maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutBytes;
        if (remaining > 0) {
          stdoutChunks.push(chunk.subarray(0, remaining));
          stdoutBytes += remaining;
        }
        outputExceeded = true;
        killAll();
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (/** @type {Buffer} */ chunk) => {
      if (stderrBytes >= maxStderrBytes) return;
      const remaining = maxStderrBytes - stderrBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stderrChunks.push(slice);
      stderrBytes += slice.length;
    });

    child.on('error', (err) => {
      clearTimer(timer);
      rejectPromise(err);
    });

    child.on('close', (codeNum) => {
      clearTimer(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      let stderr = Buffer.concat(stderrChunks).toString('utf8');
      const compileError = codeNum === 100 && stderr.includes(COMPILE_ERR_MARKER);
      if (compileError) {
        stderr = stderr.replace(COMPILE_ERR_MARKER, '').trim();
      }
      resolvePromise({
        exitCode: codeNum ?? 137,
        stdout,
        stderr,
        timedOut,
        outputExceeded,
        compileError,
      });
    });

    const codeB64 = Buffer.from(String(code ?? ''), 'utf8').toString('base64');
    const inputB64 = Buffer.from(String(stdin ?? ''), 'utf8').toString('base64');
    child.stdin.on('error', () => {});
    child.stdin.end(`${codeB64}\n${inputB64}\n`);
  });
}

/**
 * Judges a C++17 submission against all lab test cases inside the hardened Docker sandbox.
 * Matches the `judgeCode` interface consumed by `src/worker.js`.
 * @param {{
 *   code: string,
 *   tests: Array<{ id?: number, name: string, input: string, expectedOutput: string }>,
 *   image?: string,
 *   memoryMb?: number,
 *   pidsLimit?: number,
 *   cpuLimitSec?: number,
 *   wallClockMs?: number,
 *   maxOutputBytes?: number
 * }} params
 * @returns {Promise<{ status: 'accepted' | 'failed' | 'error', compileOutput: string, judgeOutput: string }>}
 */
export async function judgeSubmissionInSandbox({
  code,
  tests,
  image,
  memoryMb,
  pidsLimit,
  cpuLimitSec,
  wallClockMs,
  maxOutputBytes,
}) {
  const testList = Array.isArray(tests) ? tests : [];
  if (testList.length === 0) {
    const res = await runInSandbox({
      code,
      stdin: '',
      image,
      memoryMb,
      pidsLimit,
      cpuLimitSec,
      wallClockMs,
      maxOutputBytes,
    });
    if (res.compileError) {
      return { status: 'failed', compileOutput: res.stderr, judgeOutput: 'Compilation Error' };
    }
    if (res.timedOut) {
      return { status: 'failed', compileOutput: '', judgeOutput: 'Time Limit Exceeded' };
    }
    if (res.outputExceeded) {
      return { status: 'failed', compileOutput: '', judgeOutput: 'Output Limit Exceeded' };
    }
    if (res.exitCode !== 0) {
      return {
        status: 'failed',
        compileOutput: '',
        judgeOutput: `Runtime Error (exit ${res.exitCode})`,
      };
    }
    return { status: 'accepted', compileOutput: '', judgeOutput: '0/0 tests passed' };
  }

  for (const t of testList) {
    const res = await runInSandbox({
      code,
      stdin: t.input,
      image,
      memoryMb,
      pidsLimit,
      cpuLimitSec,
      wallClockMs,
      maxOutputBytes,
    });

    if (res.compileError) {
      return { status: 'failed', compileOutput: res.stderr, judgeOutput: 'Compilation Error' };
    }
    if (res.timedOut) {
      return {
        status: 'failed',
        compileOutput: '',
        judgeOutput: `Time Limit Exceeded on test ${t.name}`,
      };
    }
    if (res.outputExceeded) {
      return {
        status: 'failed',
        compileOutput: '',
        judgeOutput: `Output Limit Exceeded on test ${t.name}`,
      };
    }
    if (res.exitCode !== 0) {
      return {
        status: 'failed',
        compileOutput: '',
        judgeOutput: `Runtime Error (exit ${res.exitCode}) on test ${t.name}`,
      };
    }
    if (!tokensEqual(res.stdout, t.expectedOutput)) {
      return {
        status: 'failed',
        compileOutput: '',
        judgeOutput: `Wrong Answer on test ${t.name}`,
      };
    }
  }

  return {
    status: 'accepted',
    compileOutput: '',
    judgeOutput: `${testList.length}/${testList.length} tests passed`,
  };
}
