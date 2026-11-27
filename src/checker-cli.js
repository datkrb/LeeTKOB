#!/usr/bin/env node
// LeeTKOB dataset constraint checker CLI.
// Works strictly from problems/<id>/statement.md, problems/<id>/constraints.json, and solutions/<id>/*.cpp.
// Set MODEL_OFF=1 to run deterministic hard rules only and emit "unsure" for semantic constraints with no network.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { checkSubmissionConstraints } from './checker.js';

/**
 * Lists sorted subdirectory names inside a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function listSubdirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/**
 * Runs the constraint checker over every (solution, constraint) pair in a dataset folder.
 * Never reads `labels.jsonl`.
 * @param {{
 *   dataDir: string,
 *   outPath: string,
 *   callLogPath?: string,
 *   modelOff?: boolean,
 *   delayMs?: number,
 *   timeoutMs?: number,
 *   model?: string,
 *   provider?: string,
 *   callModel?: (args: { prompt: string, signal: AbortSignal }) => Promise<any>
 * }} options
 */
export async function runDatasetChecker(options) {
  const root = resolve(options.dataDir);
  const problemsRoot = join(root, 'problems');
  const solutionsRoot = join(root, 'solutions');
  const isModelOff = options.modelOff ?? process.env.MODEL_OFF === '1';
  const delayMs = Number(options.delayMs ?? process.env.LLM_CALL_DELAY_MS ?? 0);

  const problemIds = listSubdirs(problemsRoot);
  /** @type {string[]} */
  const predictionLines = [];
  /** @type {string[]} */
  const callLogLines = [];

  let solutionCount = 0;
  let pairCount = 0;
  let modelCallCount = 0;

  for (const problemId of problemIds) {
    const probDir = join(problemsRoot, problemId);
    const statement = readFileSync(join(probDir, 'statement.md'), 'utf8');
    /** @type {Array<{ id: string, text: string, deduction?: number }>} */
    const constraints = JSON.parse(readFileSync(join(probDir, 'constraints.json'), 'utf8'));

    const solDir = join(solutionsRoot, problemId);
    const cppFiles = readdirSync(solDir)
      .filter((f) => f.endsWith('.cpp'))
      .sort();

    for (const file of cppFiles) {
      if (!isModelOff && delayMs > 0 && modelCallCount > 0) {
        await delay(delayMs);
      }

      const stem = basename(file, '.cpp');
      const solutionId = `${problemId}/${stem}`;
      const code = readFileSync(join(solDir, file), 'utf8');

      const res = await checkSubmissionConstraints({
        statement,
        constraints,
        code,
        modelOff: isModelOff,
        callModel: options.callModel,
        timeoutMs: options.timeoutMs,
        model: options.model,
        provider: options.provider,
      });

      solutionCount++;
      for (const v of res.verdicts) {
        pairCount++;
        predictionLines.push(
          JSON.stringify({
            solution: solutionId,
            constraint: v.code,
            verdict: v.verdict,
            evidence: v.evidence,
          }),
        );
      }

      if (res.callLog) {
        modelCallCount++;
        callLogLines.push(
          JSON.stringify({
            solution: solutionId,
            ...res.callLog,
          }),
        );
      }
    }
  }

  const resolvedOut = resolve(options.outPath);
  mkdirSync(dirname(resolvedOut), { recursive: true });
  writeFileSync(
    resolvedOut,
    predictionLines.join('\n') + (predictionLines.length ? '\n' : ''),
    'utf8',
  );

  if (options.callLogPath) {
    const resolvedLog = resolve(options.callLogPath);
    mkdirSync(dirname(resolvedLog), { recursive: true });
    writeFileSync(resolvedLog, callLogLines.join('\n') + (callLogLines.length ? '\n' : ''), 'utf8');
  }

  return {
    problems: problemIds.length,
    solutions: solutionCount,
    pairs: pairCount,
    modelCalls: modelCallCount,
    outPath: resolvedOut,
    callLogPath: options.callLogPath ? resolve(options.callLogPath) : null,
  };
}

/**
 * Parses CLI flags.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node src/checker-cli.js --data <dataset-dir> --out <predictions.jsonl> [--call-log <log.jsonl>] [--delay-ms <ms>] [--timeout-ms <ms>] [--model <name>]',
      );
      process.exit(0);
    }
    if (
      ![
        '--data',
        '--out',
        '--predictions',
        '--call-log',
        '--delay-ms',
        '--timeout-ms',
        '--model',
      ].includes(a)
    ) {
      throw new Error(`Unknown argument: ${a}`);
    }
    if (i + 1 >= argv.length) {
      throw new Error(`Missing value for ${a}`);
    }
    out[a.slice(2)] = argv[++i];
  }
  const dataDir = out.data;
  const outPath = out.out ?? out.predictions;
  if (!dataDir || !outPath) {
    throw new Error('--data and --out (or --predictions) are required');
  }
  return {
    dataDir,
    outPath,
    callLogPath: out['call-log'],
    delayMs: out['delay-ms'] !== undefined ? Number(out['delay-ms']) : undefined,
    timeoutMs: out['timeout-ms'] !== undefined ? Number(out['timeout-ms']) : undefined,
    model: out.model,
  };
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const summary = await runDatasetChecker(args);
    console.log(
      `Checked ${summary.solutions} solutions (${summary.pairs} pairs, ${summary.modelCalls} model calls) -> ${summary.outPath}`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
