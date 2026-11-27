// Standalone submission judging worker for LeeTKOB.
// Polls SQLite `judge_jobs`, runs the sandbox judge, then runs hard rules + semantic model
// for Accepted submissions and writes verdicts ONLY to the TA's review queue (never publishes).
import { resolve } from 'node:path';
import { clearTimeout as clearTimer, setTimeout as setTimer } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { open } from './db.js';
import { checkSubmissionConstraints } from './checker.js';
import { isLabOverBudget, parseMaxUsdPerLab, recordLlmCallLog } from './llm-log.js';
import { claimNextJob, completeJob, failJob, requeueRunningJobs } from './queue.js';

/**
 * Computes the overall submission verdict severity across all constraint verdicts.
 * @param {Array<{ verdict: 'pass' | 'violation' | 'unsure' }>} verdicts
 * @returns {'pass' | 'violation' | 'unsure'}
 */
function summarizeVerdict(verdicts) {
  if (verdicts.some((v) => v.verdict === 'violation')) return 'violation';
  if (verdicts.some((v) => v.verdict === 'unsure')) return 'unsure';
  return 'pass';
}

/**
 * Processes a single claimed judge job end-to-end.
 * Idempotent on re-run: stores exactly one set of constraint verdicts per submission
 * and never overwrites an existing TA decision or touches `labs.published_at`.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ id: number, submissionId: number, attempts: number }} job
 * @param {{
 *   judgeCode: (args: {
 *     code: string,
 *     tests: Array<{ id: number, name: string, input: string, expectedOutput: string }>
 *   }) => Promise<{ status: 'accepted' | 'failed' | 'error', compileOutput?: string, judgeOutput?: string }>,
 *   callModel?: (args: { prompt: string, signal: AbortSignal }) => Promise<any>,
 *   modelOff?: boolean,
 *   timeoutMs?: number,
 *   maxUsdPerLab?: number | null,
 *   samplePassRate?: number,
 *   random?: () => number
 * }} deps
 */
export async function processJob(db, job, deps) {
  const samplePassRate = deps.samplePassRate ?? 0.1;
  const randomFn = deps.random ?? Math.random;

  try {
    const sub =
      /** @type {{ id: number, lab_id: number, student_id: number, student_name: string, statement: string, code: string } | undefined} */ (
        db
          .prepare(
            `SELECT s.id, s.lab_id, s.student_id, u.name AS student_name, l.statement, d.code
           FROM submissions s
           JOIN users u ON u.id = s.student_id
           JOIN labs l ON l.id = s.lab_id
           JOIN submission_details d ON d.submission_id = s.id
           WHERE s.id = ?`,
          )
          .get(job.submissionId)
      );

    if (!sub) {
      failJob(db, job.id, `Submission ${job.submissionId} not found`);
      return null;
    }

    const rawTests =
      /** @type {Array<{ id: number, name: string, input: string, expected_output: string }>} */ (
        db
          .prepare(
            'SELECT id, name, input, expected_output FROM lab_tests WHERE lab_id = ? ORDER BY id ASC',
          )
          .all(sub.lab_id)
      );
    const tests = rawTests.map((t) => ({
      id: t.id,
      name: t.name,
      input: t.input,
      expectedOutput: t.expected_output,
    }));

    const constraints =
      /** @type {Array<{ id: number, code: string, text: string, kind: string, deduction: number }>} */ (
        db
          .prepare(
            'SELECT id, code, text, kind, deduction FROM constraints WHERE lab_id = ? ORDER BY id ASC',
          )
          .all(sub.lab_id)
      );

    // 1. Judge C++ code in sandbox outside any DB write transaction
    const judgeResult = await deps.judgeCode({ code: sub.code, tests });
    const judgeStatus = judgeResult.status;

    db.prepare(
      `UPDATE submission_details
       SET status = ?,
           compile_output = ?,
           judge_output = ?,
           judged_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE submission_id = ?`,
    ).run(judgeStatus, judgeResult.compileOutput ?? null, judgeResult.judgeOutput ?? null, sub.id);

    // Non-accepted submissions skip constraint checks and finish cleanly
    if (judgeStatus !== 'accepted') {
      completeJob(db, job.id);
      return { submissionId: sub.id, judgeStatus, verdicts: [] };
    }

    // 2. Accepted submission: hard rules first, then semantic model (under limits + budget cap)
    const maxCap = deps.maxUsdPerLab !== undefined ? deps.maxUsdPerLab : parseMaxUsdPerLab();
    const overBudget = isLabOverBudget(db, sub.lab_id, maxCap);

    const checkRes = await checkSubmissionConstraints({
      statement: sub.statement,
      constraints,
      code: sub.code,
      studentIdentity: { studentName: sub.student_name },
      modelOff: deps.modelOff,
      budgetExceeded: overBudget,
      callModel: deps.callModel,
      timeoutMs: deps.timeoutMs,
    });

    const semanticIds = checkRes.verdicts
      .filter((v) => v.reason !== 'hard-rule')
      .map((v) => Number(v.constraint.id));
    const singleSemanticId = semanticIds.length === 1 ? semanticIds[0] : null;

    // 3. Persist call log + idempotent constraint_verdicts atomically (never publish!)
    db.exec('BEGIN IMMEDIATE');
    try {
      if (checkRes.callLog) {
        recordLlmCallLog(db, {
          submissionId: sub.id,
          constraintId: singleSemanticId,
          callLog: checkRes.callLog,
        });
      }

      const upsertVerdict = db.prepare(
        `INSERT INTO constraint_verdicts (
           submission_id, constraint_id, verdict, evidence_json, reason, decision, in_queue
         ) VALUES (?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(submission_id, constraint_id) DO UPDATE SET
           verdict = excluded.verdict,
           evidence_json = excluded.evidence_json,
           reason = excluded.reason,
           in_queue = excluded.in_queue
         WHERE decision IS NULL`,
      );

      for (const v of checkRes.verdicts) {
        const inQueue =
          v.verdict === 'violation' || v.verdict === 'unsure' || randomFn() < samplePassRate
            ? 1
            : 0;
        upsertVerdict.run(
          sub.id,
          Number(v.constraint.id),
          v.verdict,
          JSON.stringify(v.evidence),
          v.reason,
          inQueue,
        );
      }

      const overall = summarizeVerdict(checkRes.verdicts);
      db.prepare('UPDATE submissions SET verdict = ? WHERE id = ?').run(overall, sub.id);
      completeJob(db, job.id);
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    return {
      submissionId: sub.id,
      judgeStatus,
      verdicts: checkRes.verdicts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE submission_details
       SET status = 'error',
           judge_output = ?,
           judged_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE submission_id = ?`,
    ).run(message, job.submissionId);
    failJob(db, job.id, message);
    throw err;
  }
}

/**
 * Claims and processes a single queued job, or returns null if the queue is empty.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Parameters<typeof processJob>[2]} deps
 */
export async function runWorkerOnce(db, deps) {
  const job = claimNextJob(db);
  if (!job) return null;
  return processJob(db, job, deps);
}

/**
 * Creates a start/stop polling loop for running the judge worker as a separate process.
 * Recovers any interrupted `running` jobs on startup.
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   pollMs?: number,
 *   onError?: (err: unknown) => void
 * } & Parameters<typeof processJob>[2]} options
 */
export function createWorkerLoop(options) {
  const pollMs = Number(options.pollMs ?? process.env.WORKER_POLL_MS ?? 500);
  let running = false;
  /** @type {ReturnType<typeof setTimer> | null} */
  let timer = null;
  /** @type {Promise<void> | null} */
  let currentTick = null;

  async function tick() {
    if (!running) return;
    try {
      const processed = await runWorkerOnce(options.db, options);
      if (!running) return;
      // Drain immediately when a job was found; otherwise wait pollMs
      timer = setTimer(scheduleTick, processed ? 0 : pollMs);
    } catch (err) {
      if (options.onError) options.onError(err);
      else console.error('worker tick error:', err);
      if (running) {
        timer = setTimer(scheduleTick, pollMs);
      }
    }
  }

  function scheduleTick() {
    timer = null;
    if (!running) return;
    currentTick = tick().finally(() => {
      currentTick = null;
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      requeueRunningJobs(options.db);
      scheduleTick();
    },
    async stop() {
      running = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (currentTick) {
        await currentTick;
      }
    },
    isRunning() {
      return running;
    },
  };
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const dbPath = process.env.DB_PATH || 'data/leetkob.db';
  const db = open(dbPath);
  /** @type {Parameters<typeof processJob>[2]['judgeCode']} */
  let judgeCode;
  try {
    // Dynamic import so worker integrates with src/sandbox.js once available on main.
    const sandboxModule = './sandbox.js';
    const sandboxMod = await import(sandboxModule);
    judgeCode = sandboxMod.judgeSubmissionInSandbox;
  } catch {
    console.error('Sandbox runner (src/sandbox.js) is not available yet.');
    db.close();
    process.exit(1);
  }

  const loop = createWorkerLoop({ db, judgeCode });
  console.log(`LeeTKOB worker started (db: ${dbPath})`);
  loop.start();

  const shutdown = async () => {
    await loop.stop();
    db.close();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      void shutdown();
    });
  }
}
