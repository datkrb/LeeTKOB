import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open } from '../../src/db.js';
import {
  enqueueSubmission,
  claimNextJob,
  completeJob,
  failJob,
  requeueRunningJobs,
  getQueueStats,
} from '../../src/queue.js';

test('enqueueSubmission creates submission, details, and queued judge_job atomically', () => {
  const db = open(':memory:');
  try {
    const { submissionId, jobId } = enqueueSubmission(db, {
      labId: 1,
      studentId: 4,
      code: 'int main() { return 0; }\n',
    });

    assert.equal(submissionId > 0, true);
    assert.equal(jobId > 0, true);

    const detail = /** @type {{ status: string, code: string }} */ (
      db
        .prepare('SELECT status, code FROM submission_details WHERE submission_id = ?')
        .get(submissionId)
    );
    assert.equal(detail.status, 'queued');
    assert.equal(detail.code, 'int main() { return 0; }\n');

    const job = /** @type {{ status: string, attempts: number }} */ (
      db.prepare('SELECT status, attempts FROM judge_jobs WHERE id = ?').get(jobId)
    );
    assert.equal(job.status, 'queued');
    assert.equal(job.attempts, 0);
    assert.deepEqual(getQueueStats(db), { queued: 1, running: 0, done: 0, failed: 0 });
  } finally {
    db.close();
  }
});

test('claimNextJob claims jobs FIFO, prevents double claim, and supports complete/fail transitions', () => {
  const db = open(':memory:');
  try {
    const first = enqueueSubmission(db, { labId: 1, studentId: 4, code: '// 1' });
    const second = enqueueSubmission(db, { labId: 1, studentId: 5, code: '// 2' });

    const claimed1 = claimNextJob(db);
    assert.ok(claimed1);
    assert.equal(claimed1.submissionId, first.submissionId);
    assert.equal(claimed1.attempts, 1);

    const claimed2 = claimNextJob(db);
    assert.ok(claimed2);
    assert.equal(claimed2.submissionId, second.submissionId);
    assert.equal(claimed2.attempts, 1);

    // No more queued jobs available
    assert.equal(claimNextJob(db), null);
    assert.deepEqual(getQueueStats(db), { queued: 0, running: 2, done: 0, failed: 0 });

    completeJob(db, claimed1.id);
    failJob(db, claimed2.id, 'sandbox error');
    assert.deepEqual(getQueueStats(db), { queued: 0, running: 0, done: 1, failed: 1 });
  } finally {
    db.close();
  }
});

test('requeueRunningJobs recovers interrupted jobs after a worker crash/restart', () => {
  const db = open(':memory:');
  try {
    const { submissionId } = enqueueSubmission(db, {
      labId: 1,
      studentId: 4,
      code: '// crash test',
    });
    const claimed = claimNextJob(db);
    assert.ok(claimed);
    assert.equal(claimed.attempts, 1);

    // Simulate worker dying mid-job and restarting
    const recovered = requeueRunningJobs(db);
    assert.equal(recovered, 1);

    const reclaimed = claimNextJob(db);
    assert.ok(reclaimed);
    assert.equal(reclaimed.submissionId, submissionId);
    assert.equal(reclaimed.attempts, 2);
  } finally {
    db.close();
  }
});
