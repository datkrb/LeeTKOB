import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { stripCppForModel } from '../../src/strip.js';
import { validateModelOutput, runModelWithLimits } from '../../src/llm-limits.js';

const SAMPLE_CPP = [
  '#include <iostream>',
  'int a[100005]; // fixed buffer',
  'int main() {',
  '  int n = 0;',
  '  return 0;',
  '}',
].join('\n');

test('validateModelOutput accepts valid verdicts and maps violation evidence back to original line', () => {
  const { originalLines, strippedLines } = stripCppForModel(SAMPLE_CPP);
  const rawText = JSON.stringify({
    verdicts: [
      {
        constraint: 'C2',
        verdict: 'violation',
        evidence: [{ line: 2, text: 'int a[100005];' }],
      },
      {
        constraint: 'C3',
        verdict: 'pass',
        evidence: [],
      },
    ],
  });

  const res = validateModelOutput({
    rawText,
    expectedConstraints: ['C2', 'C3'],
    originalLines,
    strippedLines,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.verdicts, [
    {
      constraint: 'C2',
      verdict: 'violation',
      evidence: [{ line: 2, text: 'int a[100005]; // fixed buffer' }],
      reason: 'model',
    },
    {
      constraint: 'C3',
      verdict: 'pass',
      evidence: [],
      reason: 'model',
    },
  ]);
});

test('validateModelOutput turns malformed JSON, unknown keys, deduction fields, or missing constraints into unsure', () => {
  const { originalLines, strippedLines } = stripCppForModel(SAMPLE_CPP);

  const nonJson = validateModelOutput({
    rawText: 'All constraints passed!',
    expectedConstraints: ['C2'],
    originalLines,
    strippedLines,
  });
  assert.equal(nonJson.ok, false);
  assert.equal(nonJson.status, 'schema_error');
  assert.equal(nonJson.verdicts[0].verdict, 'unsure');

  const withDeduction = validateModelOutput({
    rawText: JSON.stringify({
      verdicts: [{ constraint: 'C2', verdict: 'violation', deduction: 4, evidence: [] }],
    }),
    expectedConstraints: ['C2'],
    originalLines,
    strippedLines,
  });
  assert.equal(withDeduction.ok, false);
  assert.equal(withDeduction.status, 'schema_error');
  assert.equal(withDeduction.verdicts[0].verdict, 'unsure');

  const missingSecond = validateModelOutput({
    rawText: JSON.stringify({
      verdicts: [{ constraint: 'C2', verdict: 'pass', evidence: [] }],
    }),
    expectedConstraints: ['C2', 'C3'],
    originalLines,
    strippedLines,
  });
  assert.equal(missingSecond.ok, false);
  assert.equal(missingSecond.status, 'schema_error');
  assert.deepEqual(
    missingSecond.verdicts.map((v) => v.verdict),
    ['unsure', 'unsure'],
  );
});

test('validateModelOutput turns violations with empty or hallucinated evidence lines into unsure', () => {
  const { originalLines, strippedLines } = stripCppForModel(SAMPLE_CPP);

  const emptyEv = validateModelOutput({
    rawText: JSON.stringify({
      verdicts: [{ constraint: 'C2', verdict: 'violation', evidence: [] }],
    }),
    expectedConstraints: ['C2'],
    originalLines,
    strippedLines,
  });
  assert.equal(emptyEv.ok, false);
  assert.equal(emptyEv.status, 'schema_error');
  assert.equal(emptyEv.verdicts[0].verdict, 'unsure');
  assert.deepEqual(emptyEv.verdicts[0].evidence, []);

  const hallucinatedLine = validateModelOutput({
    rawText: JSON.stringify({
      verdicts: [
        {
          constraint: 'C2',
          verdict: 'violation',
          evidence: [{ line: 2, text: 'std::vector<int> a;' }],
        },
      ],
    }),
    expectedConstraints: ['C2'],
    originalLines,
    strippedLines,
  });
  assert.equal(hallucinatedLine.ok, false);
  assert.equal(hallucinatedLine.status, 'schema_error');
  assert.equal(hallucinatedLine.verdicts[0].verdict, 'unsure');

  const outOfRange = validateModelOutput({
    rawText: JSON.stringify({
      verdicts: [
        {
          constraint: 'C2',
          verdict: 'violation',
          evidence: [{ line: 99, text: 'return 0;' }],
        },
      ],
    }),
    expectedConstraints: ['C2'],
    originalLines,
    strippedLines,
  });
  assert.equal(outOfRange.ok, false);
  assert.equal(outOfRange.verdicts[0].verdict, 'unsure');
});

test('runModelWithLimits converts a timed-out fake model call into unsure with status timeout', async () => {
  const { originalLines, strippedLines } = stripCppForModel(SAMPLE_CPP);
  let signalAborted = false;

  const slowFakeModel = async ({ signal }) => {
    signal?.addEventListener('abort', () => {
      signalAborted = true;
    });
    await delay(250, undefined, { ref: false });
    return {
      provider: 'gemini',
      model: 'fake-model',
      requestId: 'req-late',
      responseText: JSON.stringify({
        verdicts: [
          {
            constraint: 'C2',
            verdict: 'violation',
            evidence: [{ line: 2, text: 'int a[100005];' }],
          },
        ],
      }),
      promptTokens: 100,
      outputTokens: 20,
      latencyMs: 250,
      costUsd: 0.0001,
    };
  };

  const res = await runModelWithLimits({
    prompt: 'fake prompt',
    expectedConstraints: ['C2', 'C3'],
    originalLines,
    strippedLines,
    callModel: slowFakeModel,
    timeoutMs: 30,
  });

  assert.equal(res.status, 'timeout');
  assert.equal(signalAborted, true);
  assert.equal(res.callLog.status, 'timeout');
  assert.deepEqual(res.verdicts, [
    { constraint: 'C2', verdict: 'unsure', evidence: [], reason: 'timeout' },
    { constraint: 'C3', verdict: 'unsure', evidence: [], reason: 'timeout' },
  ]);
});

test('runModelWithLimits converts a throwing fake model call into unsure with status error', async () => {
  const { originalLines, strippedLines } = stripCppForModel(SAMPLE_CPP);

  const brokenFakeModel = async () => {
    throw new Error('simulated 503 from fake provider');
  };

  const res = await runModelWithLimits({
    prompt: 'fake prompt',
    expectedConstraints: ['C2'],
    originalLines,
    strippedLines,
    callModel: brokenFakeModel,
    timeoutMs: 500,
  });

  assert.equal(res.status, 'error');
  assert.equal(res.callLog.status, 'error');
  assert.deepEqual(res.verdicts, [
    { constraint: 'C2', verdict: 'unsure', evidence: [], reason: 'model_error' },
  ]);
});
