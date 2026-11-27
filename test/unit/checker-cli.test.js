import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runDatasetChecker } from '../../src/checker-cli.js';

function createMiniDataset() {
  const dir = mkdtempSync(join(tmpdir(), 'leetkob-checker-ds-'));
  mkdirSync(join(dir, 'problems', 'demo-sort'), { recursive: true });
  mkdirSync(join(dir, 'solutions', 'demo-sort'), { recursive: true });

  writeFileSync(
    join(dir, 'problems', 'demo-sort', 'statement.md'),
    '# Demo Sort\nSort N integers in ascending order.\n',
  );
  writeFileSync(
    join(dir, 'problems', 'demo-sort', 'constraints.json'),
    JSON.stringify([
      {
        id: 'C1',
        text: 'Do not call a library sort function: `std::sort`, `qsort`.',
        deduction: 3,
      },
      {
        id: 'C2',
        text: 'Implement merge sort yourself.',
        deduction: 4,
      },
    ]),
  );
  writeFileSync(
    join(dir, 'solutions', 'demo-sort', 's01.cpp'),
    [
      '// Author: Student A (23120001)',
      '#include <algorithm>',
      'int main() {',
      '  int a[2] = {2, 1};',
      '  std::sort(a, a + 2);',
      '  return 0;',
      '}',
    ].join('\n'),
  );
  return dir;
}

test('runDatasetChecker works from statement.md and constraints.json alone in MODEL_OFF mode', async () => {
  const dir = createMiniDataset();
  const outPath = join(dir, 'predictions.jsonl');
  let calls = 0;

  try {
    const summary = await runDatasetChecker({
      dataDir: dir,
      outPath,
      modelOff: true,
      callModel: async () => {
        calls++;
        throw new Error('must not call model when modelOff is true');
      },
    });

    assert.equal(calls, 0);
    assert.equal(summary.solutions, 1);
    assert.equal(summary.pairs, 2);

    const lines = readFileSync(outPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      solution: 'demo-sort/s01',
      constraint: 'C1',
      verdict: 'violation',
      evidence: [{ line: 5, text: 'std::sort(a, a + 2);' }],
    });
    assert.deepEqual(lines[1], {
      solution: 'demo-sort/s01',
      constraint: 'C2',
      verdict: 'unsure',
      evidence: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runDatasetChecker writes semantic call logs when model is enabled with fake provider', async () => {
  const dir = createMiniDataset();
  const outPath = join(dir, 'predictions.jsonl');
  const callLogPath = join(dir, 'call-log.jsonl');

  try {
    await runDatasetChecker({
      dataDir: dir,
      outPath,
      callLogPath,
      modelOff: false,
      callModel: async () => ({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        requestId: 'req-cli-001',
        responseText: JSON.stringify({
          verdicts: [
            {
              constraint: 'C2',
              verdict: 'violation',
              evidence: [{ line: 5, text: 'std::sort(a, a + 2);' }],
            },
          ],
        }),
        promptTokens: 150,
        outputTokens: 40,
        latencyMs: 55,
        costUsd: 0.000145,
      }),
    });

    const preds = readFileSync(outPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(preds[1].verdict, 'violation');
    assert.deepEqual(preds[1].evidence, [{ line: 5, text: 'std::sort(a, a + 2);' }]);

    const logs = readFileSync(callLogPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].solution, 'demo-sort/s01');
    assert.equal(logs[0].requestId, 'req-cli-001');
    assert.equal(logs[0].status, 'ok');
    assert.equal(logs[0].prompt.includes('23120001'), false);
    assert.equal(logs[0].prompt.includes('Do not call a library sort'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MODEL_OFF=1 on published dev set produces valid predictions accepted by eval.mjs with 0 wrongful', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'leetkob-dev-off-'));
  const outPath = join(tmpDir, 'dev-model-off.jsonl');
  const summaryPath = join(tmpDir, 'summary.json');
  const devDir = resolve('leetkob-eval');
  const evalScript = join(devDir, 'eval.mjs');

  try {
    await runDatasetChecker({
      dataDir: devDir,
      outPath,
      modelOff: true,
    });

    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        [evalScript, '--data', devDir, '--predictions', outPath, '--json', summaryPath],
        { stdio: 'pipe' },
      );
    } catch (err) {
      exitCode = /** @type {{ status?: number }} */ (err).status ?? 2;
    }

    assert.ok(exitCode === 0 || exitCode === 1, `eval.mjs must exit 0 or 1, got ${exitCode}`);
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    assert.equal(summary.wrongful, 0);
    assert.equal(summary.missing, 0);
    // 102 total pairs: 55 hard-rule pairs decided, 47 semantic pairs marked unsure
    assert.equal(summary.pairs, 102);
    assert.equal(summary.unsure, 47);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
