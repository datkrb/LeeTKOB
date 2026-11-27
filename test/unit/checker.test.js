import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSubmissionConstraints } from '../../src/checker.js';

const CONSTRAINTS = [
  {
    id: 'C1',
    text: 'Do not call a library sort function: `std::sort`, `std::stable_sort`, `qsort`.',
    deduction: 3,
  },
  {
    id: 'C2',
    text: 'Sort with a merge sort you wrote yourself.',
    deduction: 4,
  },
];

const CODE = [
  '// Author: Student X (23120000)',
  '#include <algorithm>',
  'int main() {',
  '  int a[2] = {2, 1};',
  '  std::sort(a, a + 2);',
  '  return 0;',
  '}',
].join('\n');

test('hard-rule-only constraints never invoke the model', async () => {
  let calls = 0;
  const res = await checkSubmissionConstraints({
    statement: 'Sort the array.',
    constraints: [CONSTRAINTS[0]],
    code: CODE,
    callModel: async () => {
      calls++;
      throw new Error('must not be called');
    },
  });

  assert.equal(calls, 0);
  assert.equal(res.callLog, null);
  assert.equal(res.verdicts.length, 1);
  assert.equal(res.verdicts[0].verdict, 'violation');
  assert.deepEqual(res.verdicts[0].evidence, [{ line: 5, text: 'std::sort(a, a + 2);' }]);
});

test('hard rules run first and only semantic constraints are sent to the model', async () => {
  /** @type {string[]} */
  const prompts = [];

  const res = await checkSubmissionConstraints({
    statement: 'Sort the array in ascending order.',
    constraints: CONSTRAINTS,
    code: CODE,
    studentIdentity: { studentName: 'Student X', studentId: '23120000' },
    callModel: async ({ prompt }) => {
      prompts.push(prompt);
      return {
        provider: 'gemini',
        model: 'fake-gemini',
        requestId: 'req-semantic-1',
        responseText: JSON.stringify({
          verdicts: [
            {
              constraint: 'C2',
              verdict: 'violation',
              evidence: [{ line: 5, text: 'std::sort(a, a + 2);' }],
            },
          ],
        }),
        promptTokens: 120,
        outputTokens: 35,
        latencyMs: 42,
        costUsd: 0.0001235,
      };
    },
  });

  assert.equal(prompts.length, 1);
  // C1 was decided by hard rules, so the model prompt must NOT include C1 or its text
  assert.equal(prompts[0].includes('"C1"'), false);
  assert.equal(prompts[0].includes('Do not call a library sort function'), false);
  assert.equal(prompts[0].includes('"C2"'), true);
  assert.equal(prompts[0].includes('Student X'), false);
  assert.equal(prompts[0].includes('23120000'), false);

  assert.equal(res.verdicts.length, 2);
  assert.equal(res.verdicts[0].code, 'C1');
  assert.equal(res.verdicts[0].reason, 'hard-rule');
  assert.equal(res.verdicts[0].verdict, 'violation');
  assert.equal(res.verdicts[1].code, 'C2');
  assert.equal(res.verdicts[1].reason, 'model');
  assert.equal(res.verdicts[1].verdict, 'violation');
  assert.equal(res.callLog?.requestId, 'req-semantic-1');
});

test('modelOff mode runs hard rules only, sets semantic constraints to unsure, and never calls the model', async () => {
  let calls = 0;

  const res = await checkSubmissionConstraints({
    statement: 'Sort the array.',
    constraints: CONSTRAINTS,
    code: CODE,
    modelOff: true,
    callModel: async () => {
      calls++;
      throw new Error('must not be called when modelOff is true');
    },
  });

  assert.equal(calls, 0);
  assert.equal(res.callLog, null);
  assert.equal(res.verdicts[0].verdict, 'violation');
  assert.equal(res.verdicts[0].reason, 'hard-rule');
  assert.equal(res.verdicts[1].verdict, 'unsure');
  assert.equal(res.verdicts[1].reason, 'model_off');
  assert.deepEqual(res.verdicts[1].evidence, []);
});

test('budgetExceeded skips model calls and marks semantic constraints unsure', async () => {
  let calls = 0;

  const res = await checkSubmissionConstraints({
    statement: 'Sort the array.',
    constraints: CONSTRAINTS,
    code: CODE,
    budgetExceeded: true,
    callModel: async () => {
      calls++;
      throw new Error('must not be called when budget is exceeded');
    },
  });

  assert.equal(calls, 0);
  assert.equal(res.callLog, null);
  assert.equal(res.verdicts[0].verdict, 'violation');
  assert.equal(res.verdicts[1].verdict, 'unsure');
  assert.equal(res.verdicts[1].reason, 'budget_exceeded');
});
