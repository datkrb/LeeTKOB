// SQLite persistence for LLM call logs and per-lab USD cost-cap checks.

/**
 * Parses LLM_MAX_USD_PER_LAB into a non-negative number, or null when unset.
 * @param {string | number | null | undefined} [raw]
 * @returns {number | null}
 */
export function parseMaxUsdPerLab(raw = process.env.LLM_MAX_USD_PER_LAB) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const val = Number(trimmed);
  if (!Number.isFinite(val) || val < 0) return null;
  return val;
}

/**
 * Inserts a model call log row into `llm_call_logs`.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{
 *   submissionId?: number | null,
 *   constraintId?: number | null,
 *   callLog: {
 *     provider: string,
 *     model: string,
 *     requestId: string | null,
 *     prompt: string,
 *     responseText: string | null,
 *     promptTokens: number,
 *     outputTokens: number,
 *     latencyMs: number,
 *     costUsd: number,
 *     status: 'ok' | 'timeout' | 'schema_error' | 'error'
 *   }
 * }} params
 * @returns {number}
 */
export function recordLlmCallLog(db, { submissionId = null, constraintId = null, callLog }) {
  const stmt = db.prepare(`
    INSERT INTO llm_call_logs (
      submission_id, constraint_id, provider, model, request_id,
      prompt, response_text, prompt_tokens, output_tokens, latency_ms, cost_usd, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    submissionId,
    constraintId,
    callLog.provider,
    callLog.model,
    callLog.requestId,
    callLog.prompt,
    callLog.responseText,
    callLog.promptTokens,
    callLog.outputTokens,
    callLog.latencyMs,
    callLog.costUsd,
    callLog.status,
  );
  return Number(info.lastInsertRowid);
}

/**
 * Computes total cumulative LLM spend (USD) recorded for a lab.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} labId
 * @returns {number}
 */
export function getLabLlmSpendUsd(db, labId) {
  const row = /** @type {{ total: number } | undefined} */ (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.cost_usd), 0) AS total
         FROM llm_call_logs l
         JOIN submissions s ON s.id = l.submission_id
         WHERE s.lab_id = ?`,
      )
      .get(labId)
  );
  return Number((row?.total ?? 0).toFixed(8));
}

/**
 * Returns true if the lab has reached or exceeded its configured USD spending cap.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} labId
 * @param {number | null} [maxUsdPerLab]
 * @returns {boolean}
 */
export function isLabOverBudget(db, labId, maxUsdPerLab = parseMaxUsdPerLab()) {
  if (maxUsdPerLab === null) return false;
  return getLabLlmSpendUsd(db, labId) >= maxUsdPerLab;
}

/**
 * Lists recorded LLM call logs, optionally filtered by submissionId.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ submissionId?: number }} [filter]
 * @returns {Array<Record<string, unknown>>}
 */
export function listLlmCallLogs(db, filter = {}) {
  if (filter.submissionId !== undefined) {
    return /** @type {Array<Record<string, unknown>>} */ (
      db
        .prepare('SELECT * FROM llm_call_logs WHERE submission_id = ? ORDER BY id ASC')
        .all(filter.submissionId)
    );
  }
  return /** @type {Array<Record<string, unknown>>} */ (
    db.prepare('SELECT * FROM llm_call_logs ORDER BY id ASC').all()
  );
}
