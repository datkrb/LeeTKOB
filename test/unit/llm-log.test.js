import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from '../../src/db.js';
import {
  parseMaxUsdPerLab,
  recordLlmCallLog,
  getLabLlmSpendUsd,
  isLabOverBudget,
  listLlmCallLogs,
} from '../../src/llm-log.js';

test('parseMaxUsdPerLab handles empty, invalid, zero, and positive caps', () => {
  assert.equal(parseMaxUsdPerLab(''), null);
  assert.equal(parseMaxUsdPerLab(undefined), null);
  assert.equal(parseMaxUsdPerLab('abc'), null);
  assert.equal(parseMaxUsdPerLab('-1'), null);
  assert.equal(parseMaxUsdPerLab('0'), 0);
  assert.equal(parseMaxUsdPerLab('0.25'), 0.25);
});

test('recordLlmCallLog persists provider request_id, tokens, cost, and enforces per-lab cap', () => {
  const db = open(':memory:');

  assert.equal(getLabLlmSpendUsd(db, 1), 0);
  assert.equal(isLabOverBudget(db, 1, 0.001), false);

  const id1 = recordLlmCallLog(db, {
    submissionId: 1,
    constraintId: null,
    callLog: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      requestId: 'req-001',
      prompt: '<student_code>1: int main(){}</student_code>',
      responseText: '{"verdicts":[]}',
      promptTokens: 400,
      outputTokens: 200,
      latencyMs: 310,
      costUsd: 0.00062,
      status: 'ok',
    },
  });

  const id2 = recordLlmCallLog(db, {
    submissionId: 2,
    constraintId: null,
    callLog: {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      requestId: 'req-002',
      prompt: '<student_code>1: int main(){}</student_code>',
      responseText: '{"verdicts":[]}',
      promptTokens: 500,
      outputTokens: 250,
      latencyMs: 295,
      costUsd: 0.000775,
      status: 'ok',
    },
  });

  assert.equal(id2 > id1, true);
  assert.equal(getLabLlmSpendUsd(db, 1), 0.001395);
  assert.equal(isLabOverBudget(db, 1, 0.001), true);
  assert.equal(isLabOverBudget(db, 1, 0.01), false);
  // Lab 2 has zero spend so far
  assert.equal(getLabLlmSpendUsd(db, 2), 0);
  assert.equal(isLabOverBudget(db, 2, 0.001), false);

  const logs = listLlmCallLogs(db, { submissionId: 1 });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].request_id, 'req-001');
  assert.equal(logs[0].status, 'ok');

  db.close();
});
