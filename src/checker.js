// Constraint review pipeline: runs deterministic hard rules first, then the model
// (under schema/evidence/timeout limits) only for remaining semantic constraints.
import { evaluateHardRules } from './hard-rules.js';
import { buildSemanticPrompt, callGeminiSemanticModel } from './llm.js';
import { runModelWithLimits } from './llm-limits.js';
import { stripCppForModel } from './strip.js';

/**
 * Returns the canonical string identifier for a constraint object (`code` in DB or `id` in JSON).
 * @param {{ id: string | number, code?: string }} c
 * @returns {string}
 */
function constraintKey(c) {
  return String(c.code ?? c.id);
}

/**
 * Checks all constraints for an Accepted C++ submission.
 * - Ban-list constraints ("Do not use" / "Do not call") are decided by syntax-aware hard rules
 *   and are never sent to the model.
 * - When `modelOff` is true (or `process.env.MODEL_OFF === '1'`), semantic constraints become
 *   `unsure` with zero network/model calls.
 * - When `budgetExceeded` is true, semantic constraints become `unsure` with zero model calls.
 * @template {{ id: string | number, code?: string, text: string }} T
 * @param {{
 *   statement: string,
 *   constraints: T[],
 *   code: string,
 *   studentIdentity?: { studentName?: string, studentId?: string },
 *   modelOff?: boolean,
 *   budgetExceeded?: boolean,
 *   callModel?: (args: { prompt: string, signal: AbortSignal }) => Promise<{
 *     provider?: string,
 *     model?: string,
 *     requestId?: string | null,
 *     responseText: string,
 *     promptTokens?: number,
 *     outputTokens?: number,
 *     latencyMs?: number,
 *     costUsd?: number
 *   }>,
 *   timeoutMs?: number,
 *   model?: string,
 *   provider?: string
 * }} params
 */
export async function checkSubmissionConstraints({
  statement,
  constraints,
  code,
  studentIdentity,
  modelOff,
  budgetExceeded = false,
  callModel,
  timeoutMs,
  model,
  provider,
}) {
  const { hardVerdicts, remainingConstraints } = evaluateHardRules(code, constraints);

  /** @type {Map<string, { constraint: T, code: string, verdict: 'pass' | 'violation' | 'unsure', evidence: Array<{ line: number, text: string }>, reason: string }>} */
  const byKey = new Map();

  for (const h of hardVerdicts) {
    const k = constraintKey(h.constraint);
    byKey.set(k, {
      constraint: h.constraint,
      code: k,
      verdict: h.verdict,
      evidence: h.evidence,
      reason: h.reason,
    });
  }

  if (remainingConstraints.length === 0) {
    return {
      verdicts: constraints.map((c) => {
        const k = constraintKey(c);
        return /** @type {NonNullable<ReturnType<typeof byKey.get>>} */ (byKey.get(k));
      }),
      callLog: null,
    };
  }

  const isModelOff = modelOff ?? process.env.MODEL_OFF === '1';
  if (isModelOff || budgetExceeded) {
    const skipReason = isModelOff ? 'model_off' : 'budget_exceeded';
    for (const c of remainingConstraints) {
      const k = constraintKey(c);
      byKey.set(k, {
        constraint: c,
        code: k,
        verdict: 'unsure',
        evidence: [],
        reason: skipReason,
      });
    }
    return {
      verdicts: constraints.map((c) => {
        const k = constraintKey(c);
        return /** @type {NonNullable<ReturnType<typeof byKey.get>>} */ (byKey.get(k));
      }),
      callLog: null,
    };
  }

  const { strippedCode, originalLines, strippedLines } = stripCppForModel(code, studentIdentity);
  const prompt = buildSemanticPrompt({
    statement,
    constraints: remainingConstraints,
    strippedCode,
  });

  const expectedConstraints = remainingConstraints.map(constraintKey);
  const effectiveCallModel =
    callModel ??
    ((args) =>
      callGeminiSemanticModel({
        prompt: args.prompt,
        signal: args.signal,
        model,
      }));

  const result = await runModelWithLimits({
    prompt,
    expectedConstraints,
    originalLines,
    strippedLines,
    callModel: effectiveCallModel,
    timeoutMs,
    model,
    provider,
  });

  /** @type {Map<string, T>} */
  const constraintByKey = new Map(remainingConstraints.map((c) => [constraintKey(c), c]));
  for (const v of result.verdicts) {
    const c = /** @type {T} */ (constraintByKey.get(v.constraint));
    byKey.set(v.constraint, {
      constraint: c,
      code: v.constraint,
      verdict: v.verdict,
      evidence: v.evidence,
      reason: v.reason,
    });
  }

  return {
    verdicts: constraints.map((c) => {
      const k = constraintKey(c);
      return /** @type {NonNullable<ReturnType<typeof byKey.get>>} */ (byKey.get(k));
    }),
    callLog: result.callLog,
  };
}
