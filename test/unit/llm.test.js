import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticPrompt, callGeminiSemanticModel, estimateCostUsd } from '../../src/llm.js';
import { stripCppForModel } from '../../src/strip.js';

test('buildSemanticPrompt sends only statement, constraint texts (no deductions), and stripped code', () => {
  const rawCode = [
    '// Student: Le Van C - 23120888',
    '#include <iostream>',
    'int main() {',
    '  return 0; // comment stripped',
    '}',
  ].join('\n');
  const { strippedCode } = stripCppForModel(rawCode, {
    studentName: 'Le Van C',
    studentId: '23120888',
  });

  const prompt = buildSemanticPrompt({
    statement: 'Read N integers and print their sum.',
    constraints: [
      /** @type {any} */ ({
        id: 'C2',
        text: 'Compute the sum recursively without loops.',
        deduction: 4,
      }),
    ],
    strippedCode,
  });

  assert.equal(prompt.includes('Read N integers and print their sum.'), true);
  assert.equal(prompt.includes('Compute the sum recursively without loops.'), true);
  assert.equal(prompt.includes('deduction'), false);
  assert.equal(prompt.includes('23120888'), false);
  assert.equal(prompt.includes('Le Van C'), false);
  assert.equal(prompt.includes('comment stripped'), false);
});

test('estimateCostUsd computes exact token arithmetic', () => {
  const cost = estimateCostUsd({
    promptTokens: 1000,
    outputTokens: 400,
    inputUsdPer1M: 0.3,
    outputUsdPer1M: 2.5,
  });
  // 1000 * 0.3e-6 + 400 * 2.5e-6 = 0.0003 + 0.0010 = 0.0013
  assert.equal(cost, 0.0013);
});

test('callGeminiSemanticModel sends API key in header and extracts requestId, tokens, and text', async () => {
  /** @type {{ url: string, init: any } | null} */
  let captured = null;

  const fakeFetch = /** @type {typeof fetch} */ (
    async (url, init) => {
      captured = { url: String(url), init };
      const payload = {
        responseId: 'req-gemini-abc123',
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'internal reasoning' },
                {
                  text: JSON.stringify({
                    verdicts: [{ constraint: 'C2', verdict: 'pass', evidence: [] }],
                  }),
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 500,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 150,
        },
      };
      return /** @type {any} */ ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(payload),
      });
    }
  );

  const res = await callGeminiSemanticModel({
    prompt: 'test prompt',
    apiKey: 'fake-key-for-unit-test',
    model: 'gemini-2.5-flash',
    fetchImpl: fakeFetch,
  });

  assert.ok(captured);
  assert.equal(captured.url.includes('fake-key-for-unit-test'), false);
  assert.equal(captured.init.headers['x-goog-api-key'], 'fake-key-for-unit-test');
  assert.equal(res.requestId, 'req-gemini-abc123');
  assert.equal(res.promptTokens, 500);
  assert.equal(res.outputTokens, 200);
  assert.equal(
    res.responseText,
    JSON.stringify({ verdicts: [{ constraint: 'C2', verdict: 'pass', evidence: [] }] }),
  );
  assert.equal(typeof res.latencyMs, 'number');
  assert.equal(res.costUsd, 0.00065);
});
