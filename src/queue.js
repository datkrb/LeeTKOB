// SQLite-backed FIFO submission judge queue for LeeTKOB.
// Supports atomic job claiming across separate server and worker processes.

/**
 * Runs `fn` inside a SQLite IMMEDIATE transaction (serializes writers safely under WAL).
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Inserts a new student submission, its source details, and a queued judge_job atomically.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ labId: number, studentId: number, code: string }} params
 * @returns {{ submissionId: number, jobId: number }}
 */
export function enqueueSubmission(db, { labId, studentId, code }) {
  return withTransaction(db, () => {
    const subInfo = db
      .prepare(
        "INSERT INTO submissions (lab_id, student_id, verdict, decision) VALUES (?, ?, 'pass', NULL)",
      )
      .run(labId, studentId);
    const submissionId = Number(subInfo.lastInsertRowid);

    db.prepare(
      "INSERT INTO submission_details (submission_id, code, status) VALUES (?, ?, 'queued')",
    ).run(submissionId, String(code ?? ''));

    const jobInfo = db
      .prepare("INSERT INTO judge_jobs (submission_id, status, attempts) VALUES (?, 'queued', 0)")
      .run(submissionId);
    const jobId = Number(jobInfo.lastInsertRowid);

    return { submissionId, jobId };
  });
}

/**
 * Atomically claims the oldest queued job and transitions it to `running`.
 * Returns null if the queue has no queued jobs.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ id: number, submissionId: number, attempts: number } | null}
 */
export function claimNextJob(db) {
  return withTransaction(db, () => {
    const row = /** @type {{ id: number, submission_id: number, attempts: number } | undefined} */ (
      db
        .prepare(
          `SELECT id, submission_id, attempts
           FROM judge_jobs
           WHERE status = 'queued'
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get()
    );
    if (!row) return null;

    const { changes } = db
      .prepare(
        `UPDATE judge_jobs
         SET status = 'running',
             attempts = attempts + 1,
             locked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             error = NULL
         WHERE id = ? AND status = 'queued'`,
      )
      .run(row.id);

    if (changes === 0) return null;

    db.prepare("UPDATE submission_details SET status = 'judging' WHERE submission_id = ?").run(
      row.submission_id,
    );

    return {
      id: row.id,
      submissionId: row.submission_id,
      attempts: row.attempts + 1,
    };
  });
}

/**
 * Marks a running job as completed (`done`).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} jobId
 */
export function completeJob(db, jobId) {
  db.prepare(
    `UPDATE judge_jobs
     SET status = 'done',
         finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         error = NULL
     WHERE id = ?`,
  ).run(jobId);
}

/**
 * Marks a job as `failed` with an error message.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} jobId
 * @param {string} errorMessage
 */
export function failJob(db, jobId, errorMessage) {
  db.prepare(
    `UPDATE judge_jobs
     SET status = 'failed',
         finished_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
         error = ?
     WHERE id = ?`,
  ).run(String(errorMessage ?? 'unknown error'), jobId);
}

/**
 * Moves any interrupted `running` jobs back to `queued` when a worker starts up after a crash.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number}
 */
export function requeueRunningJobs(db) {
  return withTransaction(db, () => {
    const running = /** @type {Array<{ id: number, submission_id: number }>} */ (
      db.prepare("SELECT id, submission_id FROM judge_jobs WHERE status = 'running'").all()
    );
    if (running.length === 0) return 0;

    db.prepare(
      "UPDATE judge_jobs SET status = 'queued', locked_at = NULL WHERE status = 'running'",
    ).run();
    const resetDetail = db.prepare(
      "UPDATE submission_details SET status = 'queued' WHERE submission_id = ? AND status = 'judging'",
    );
    for (const r of running) {
      resetDetail.run(r.submission_id);
    }
    return running.length;
  });
}

/**
 * Returns counts of jobs in each queue state.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{ queued: number, running: number, done: number, failed: number }}
 */
export function getQueueStats(db) {
  const rows = /** @type {Array<{ status: string, n: number }>} */ (
    db.prepare('SELECT status, COUNT(*) AS n FROM judge_jobs GROUP BY status').all()
  );
  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in counts) {
      counts[/** @type {keyof typeof counts} */ (r.status)] = r.n;
    }
  }
  return counts;
}
