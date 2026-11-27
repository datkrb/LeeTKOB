// First guardrails for LeeTKOB PA#3: strict output schema + evidence-line check and call timeout.
// Any invalid output, unverified evidence line, error, or timeout becomes "unsure".
import { clearTimeout as clearTimer, setTimeout as setTimer } from 'node:timers';
import { DEFAULT_LLM_MODEL, DEFAULT_LLM_PROVIDER } from './llm.js';
import { mapEvidenceToOriginal } from './strip.js';

const VALID_VERDICTS = new Set(['pass', 'violation', 'unsure']);

/**
 * Checks whether `v` is a non-null, non-array plain object with exact keys.
 * @param {unknown} v
 * @param {string[]} allowedKeys
 * @returns {v is Record<string, any>}
 */
function hasExactKeys(v, allowedKeys) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== allowedKeys.length) return false;
  return allowedKeys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

/**
 * Builds an all-unsure fallback array for expected constraints.
 * @param {string[]} expectedConstraints
 * @param {string} reason
 * @returns {Array<{ constraint: string, verdict: 'unsure', evidence: [], reason: string }>}
 */
function allUnsure(expectedConstraints, reason) {
  return expectedConstraints.map((constraint) => ({
    constraint,
    verdict: 'unsure',
    evidence: [],
    reason,
  }));
}

/**
 * Validates raw JSON text from the model against the strict verdict schema and checks that
 * every cited evidence line matches the submitted C++ source. Maps valid evidence lines back
 * to the original source text (with comments intact).
 * @param {{
 *   rawText: string,
 *   expectedConstraints: string[],
 *   originalLines: string[],
 *   strippedLines: string[]
 * }} params
 * @returns {{
 *   ok: boolean,
 *   status: 'ok' | 'schema_error',
 *   verdicts: Array<{ constraint: string, verdict: 'pass' | 'violation' | 'unsure', evidence: Array<{ line: number, text: string }>, reason: string }>
 * }}
 */
export function validateModelOutput({
  rawText,
  expectedConstraints,
  originalLines,
  strippedLines,
}) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(String(rawText ?? ''));
  } catch {
    return {
      ok: false,
      status: 'schema_error',
      verdicts: allUnsure(expectedConstraints, 'schema_error'),
    };
  }

  if (!hasExactKeys(parsed, ['verdicts']) || !Array.isArray(parsed.verdicts)) {
    return {
      ok: false,
      status: 'schema_error',
      verdicts: allUnsure(expectedConstraints, 'schema_error'),
    };
  }

  const expectedSet = new Set(expectedConstraints);
  /** @type {Map<string, { constraint: string, verdict: 'pass' | 'violation' | 'unsure', evidence: Array<{ line: number, text: string }> }>} */
  const byConstraint = new Map();

  for (const item of parsed.verdicts) {
    if (!hasExactKeys(item, ['constraint', 'verdict', 'evidence'])) {
      return {
        ok: false,
        status: 'schema_error',
        verdicts: allUnsure(expectedConstraints, 'schema_error'),
      };
    }
    if (typeof item.constraint !== 'string' || !expectedSet.has(item.constraint)) {
      return {
        ok: false,
        status: 'schema_error',
        verdicts: allUnsure(expectedConstraints, 'schema_error'),
      };
    }
    if (byConstraint.has(item.constraint) || !VALID_VERDICTS.has(item.verdict)) {
      return {
        ok: false,
        status: 'schema_error',
        verdicts: allUnsure(expectedConstraints, 'schema_error'),
      };
    }
    if (!Array.isArray(item.evidence)) {
      return {
        ok: false,
        status: 'schema_error',
        verdicts: allUnsure(expectedConstraints, 'schema_error'),
      };
    }
    for (const ev of item.evidence) {
      if (
        !hasExactKeys(ev, ['line', 'text']) ||
        !Number.isInteger(ev.line) ||
        ev.line < 1 ||
        typeof ev.text !== 'string'
      ) {
        return {
          ok: false,
          status: 'schema_error',
          verdicts: allUnsure(expectedConstraints, 'schema_error'),
        };
      }
    }
    byConstraint.set(item.constraint, {
      constraint: item.constraint,
      verdict: /** @type {'pass' | 'violation' | 'unsure'} */ (item.verdict),
      evidence: item.evidence,
    });
  }

  if (byConstraint.size !== expectedConstraints.length) {
    return {
      ok: false,
      status: 'schema_error',
      verdicts: allUnsure(expectedConstraints, 'schema_error'),
    };
  }

  let hadEvidenceError = false;
  /** @type {Array<{ constraint: string, verdict: 'pass' | 'violation' | 'unsure', evidence: Array<{ line: number, text: string }>, reason: string }>} */
  const verdicts = [];

  for (const cid of expectedConstraints) {
    const item =
      /** @type {{ constraint: string, verdict: 'pass' | 'violation' | 'unsure', evidence: Array<{ line: number, text: string }> }} */ (
        byConstraint.get(cid)
      );

    if (item.verdict === 'pass' || item.verdict === 'unsure') {
      verdicts.push({
        constraint: cid,
        verdict: item.verdict,
        evidence: [],
        reason: 'model',
      });
      continue;
    }

    if (item.evidence.length === 0) {
      hadEvidenceError = true;
      verdicts.push({
        constraint: cid,
        verdict: 'unsure',
        evidence: [],
        reason: 'missing_evidence',
      });
      continue;
    }

    const allLinesMatch = item.evidence.every((ev) => {
      if (ev.line > originalLines.length) return false;
      const cited = ev.text.trim();
      if (!cited) return false;
      const orig = (originalLines[ev.line - 1] ?? '').trim();
      const stripped = (strippedLines[ev.line - 1] ?? '').trim();
      return cited === stripped || cited === orig;
    });

    if (!allLinesMatch) {
      hadEvidenceError = true;
      verdicts.push({
        constraint: cid,
        verdict: 'unsure',
        evidence: [],
        reason: 'invalid_evidence',
      });
      continue;
    }

    verdicts.push({
      constraint: cid,
      verdict: 'violation',
      evidence: mapEvidenceToOriginal(item.evidence, originalLines),
      reason: 'model',
    });
  }

  return {
    ok: !hadEvidenceError,
    status: hadEvidenceError ? 'schema_error' : 'ok',
    verdicts,
  };
}

/**
 * Executes a model call with a strict wall-clock timeout and schema/evidence validation.
 * @param {{
 *   prompt: string,
 *   expectedConstraints: string[],
 *   originalLines: string[],
 *   strippedLines: string[],
 *   callModel: (args: { prompt: string, signal: AbortSignal }) => Promise<{
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
export async function runModelWithLimits({
  prompt,
  expectedConstraints,
  originalLines,
  strippedLines,
  callModel,
  timeoutMs,
  model,
  provider,
}) {
  const effectiveTimeoutMs = Number(timeoutMs ?? process.env.LLM_TIMEOUT_MS ?? 15000);
  const providerName = provider || process.env.LLM_PROVIDER || DEFAULT_LLM_PROVIDER;
  const modelName = model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;

  const controller = new globalThis.AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  /** @type {ReturnType<typeof setTimer> | undefined} */
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimer(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(`Model call timed out after ${effectiveTimeoutMs}ms`));
    }, effectiveTimeoutMs);
  });

  try {
    const res = /** @type {Awaited<ReturnType<typeof callModel>>} */ (
      await Promise.race([callModel({ prompt, signal: controller.signal }), timeoutPromise])
    );

    const checked = validateModelOutput({
      rawText: res.responseText,
      expectedConstraints,
      originalLines,
      strippedLines,
    });

    return {
      status: checked.status,
      verdicts: checked.verdicts,
      callLog: {
        provider: res.provider || providerName,
        model: res.model || modelName,
        requestId: res.requestId ?? null,
        prompt,
        responseText: res.responseText ?? null,
        promptTokens: Number(res.promptTokens ?? 0),
        outputTokens: Number(res.outputTokens ?? 0),
        latencyMs: Number(res.latencyMs ?? Date.now() - startedAt),
        costUsd: Number(res.costUsd ?? 0),
        status: checked.status,
      },
    };
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if (timedOut) {
      return {
        status: /** @type {const} */ ('timeout'),
        verdicts: allUnsure(expectedConstraints, 'timeout'),
        callLog: {
          provider: providerName,
          model: modelName,
          requestId: null,
          prompt,
          responseText: null,
          promptTokens: 0,
          outputTokens: 0,
          latencyMs: elapsed,
          costUsd: 0,
          status: /** @type {const} */ ('timeout'),
        },
      };
    }

    const e = /** @type {{ requestId?: string | null, latencyMs?: number }} */ (err ?? {});
    return {
      status: /** @type {const} */ ('error'),
      verdicts: allUnsure(expectedConstraints, 'model_error'),
      callLog: {
        provider: providerName,
        model: modelName,
        requestId: e.requestId ?? null,
        prompt,
        responseText: null,
        promptTokens: 0,
        outputTokens: 0,
        latencyMs: Number(e.latencyMs ?? elapsed),
        costUsd: 0,
        status: /** @type {const} */ ('error'),
      },
    };
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
}
