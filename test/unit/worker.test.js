import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { open } from '../../src/db.js';
import { enqueueSubmission, claimNextJob } from '../../src/queue.js';
import { processJob, runWorkerOnce, createWorkerLoop } from '../../src/worker.js';

function seedLabWithConstraints(db) {
  const labInfo = db
    .prepare(
      "INSERT INTO labs (class_id, title, statement) VALUES (1, 'Sort Lab', 'Sort N integers.')",
    )
    .run();
  const labId = Number(labInfo.lastInsertRowid);

  db.prepare(
    "INSERT INTO lab_tests (lab_id, name, input, expected_output) VALUES (?, '01', '2\n2 1\n', '1 2\n')",
  ).run(labId);

  const c1 = Number(
    db
      .prepare(
        "INSERT INTO constraints (lab_id, code, text, kind, deduction) VALUES (?, 'C1', 'Do not call `std::sort`.', 'hard', 3)",
      )
      .run(labId).lastInsertRowid,
  );
  const c2 = Number(
    db
      .prepare(
        "INSERT INTO constraints (lab_id, code, text, kind, deduction) VALUES (?, 'C2', 'Implement merge sort yourself.', 'semantic', 4)",
      )
      .run(labId).lastInsertRowid,
  );
  return { labId, c1, c2 };
}

test('stop worker, submit, start worker: submission is judged once, hard rules run first, never auto-publishes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'leetkob-worker-'));
  const dbPath = join(dir, 'worker.db');
  const db = open(dbPath);

  try {
    const { labId } = seedLabWithConstraints(db);

    // 1. Submit while worker is stopped
    const code = [
      '// Student: stu1',
      '#include <algorithm>',
      'int main() {',
      '  int a[2] = {2, 1};',
      '  std::sort(a, a + 2);',
      '  return 0;',
      '}',
    ].join('\n');
    const { submissionId } = enqueueSubmission(db, { labId, studentId: 4, code });

    const before = /** @type {{ status: string }} */ (
      db.prepare('SELECT status FROM submission_details WHERE submission_id = ?').get(submissionId)
    );
    assert.equal(before.status, 'queued');

    // 2. Start worker loop with fake sandbox & fake model (no Docker/network)
    let judgeCalls = 0;
    /** @type {string[]} */
    const modelPrompts = [];

    const worker = createWorkerLoop({
      db,
      pollMs: 10,
      samplePassRate: 0,
      judgeCode: async ({ tests }) => {
        judgeCalls++;
        assert.equal(tests.length, 1);
        return { status: 'accepted', compileOutput: '', judgeOutput: '1/1 passed' };
      },
      callModel: async ({ prompt }) => {
        modelPrompts.push(prompt);
        return {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          requestId: 'req-worker-001',
          responseText: JSON.stringify({
            verdicts: [
              {
                constraint: 'C2',
                verdict: 'violation',
                evidence: [{ line: 5, text: 'std::sort(a, a + 2);' }],
              },
            ],
          }),
          promptTokens: 200,
          outputTokens: 60,
          latencyMs: 35,
          costUsd: 0.00021,
        };
      },
    });

    worker.start();
    // Wait until job reaches done
    for (let i = 0; i < 50; i++) {
      const row = /** @type {{ status: string }} */ (
        db.prepare('SELECT status FROM judge_jobs WHERE submission_id = ?').get(submissionId)
      );
      if (row.status === 'done') break;
      await delay(15);
    }
    await worker.stop();

    assert.equal(judgeCalls, 1);
    assert.equal(modelPrompts.length, 1);
    assert.equal(modelPrompts[0].includes('Do not call'), false);
    assert.equal(modelPrompts[0].includes('stu1'), false);

    const detail = /** @type {{ status: string, judged_at: string | null }} */ (
      db
        .prepare('SELECT status, judged_at FROM submission_details WHERE submission_id = ?')
        .get(submissionId)
    );
    assert.equal(detail.status, 'accepted');
    assert.ok(detail.judged_at);

    const verdicts =
      /** @type {Array<{ verdict: string, reason: string, decision: string | null, in_queue: number }>} */ (
        db
          .prepare(
            'SELECT verdict, reason, decision, in_queue FROM constraint_verdicts WHERE submission_id = ? ORDER BY constraint_id ASC',
          )
          .all(submissionId)
      );
    assert.equal(verdicts.length, 2);
    assert.equal(verdicts[0].verdict, 'violation');
    assert.equal(verdicts[0].reason, 'hard-rule');
    assert.equal(verdicts[0].decision, null);
    assert.equal(verdicts[0].in_queue, 1);
    assert.equal(verdicts[1].verdict, 'violation');
    assert.equal(verdicts[1].reason, 'model');
    assert.equal(verdicts[1].decision, null);
    assert.equal(verdicts[1].in_queue, 1);

    // Lab must NEVER be auto-published by the worker
    const lab = /** @type {{ published_at: string | null }} */ (
      db.prepare('SELECT published_at FROM labs WHERE id = ?').get(labId)
    );
    assert.equal(lab.published_at, null);

    // Restarting worker on same DB does not re-judge the completed submission
    const extra = await runWorkerOnce(db, {
      judgeCode: async () => {
        judgeCalls++;
        return { status: 'accepted' };
      },
    });
    assert.equal(extra, null);
    assert.equal(judgeCalls, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-running processJob on the same submission is idempotent and keeps exactly one set of verdicts', async () => {
  const db = open(':memory:');
  try {
    const { labId, c1 } = seedLabWithConstraints(db);
    const { submissionId } = enqueueSubmission(db, {
      labId,
      studentId: 4,
      code: 'int main() { return 0; }\n',
    });
    const job = claimNextJob(db);
    assert.ok(job);

    const deps = {
      modelOff: true,
      samplePassRate: 0,
      judgeCode: async () => ({ status: /** @type {const} */ ('accepted') }),
    };

    await processJob(db, job, deps);
    // Simulate TA reviewing C1, then worker crashing and re-running the job
    db.prepare(
      "UPDATE constraint_verdicts SET decision = 'overturn' WHERE submission_id = ? AND constraint_id = ?",
    ).run(submissionId, c1);

    await processJob(db, job, deps);

    const rows = /** @type {Array<{ constraint_id: number, decision: string | null }>} */ (
      db
        .prepare(
          'SELECT constraint_id, decision FROM constraint_verdicts WHERE submission_id = ? ORDER BY constraint_id ASC',
        )
        .all(submissionId)
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].decision, 'overturn');
  } finally {
    db.close();
  }
});

test('non-accepted submission skips hard rules and model and stores no constraint verdicts', async () => {
  const db = open(':memory:');
  try {
    const { labId } = seedLabWithConstraints(db);
    const { submissionId } = enqueueSubmission(db, {
      labId,
      studentId: 4,
      code: 'broken c++ syntax',
    });

    let modelCalls = 0;
    const res = await runWorkerOnce(db, {
      judgeCode: async () => ({
        status: 'failed',
        compileOutput: 'error: expected ;',
        judgeOutput: '',
      }),
      callModel: async () => {
        modelCalls++;
        throw new Error('must not call model on failed submission');
      },
    });

    assert.ok(res);
    assert.equal(res.judgeStatus, 'failed');
    assert.equal(modelCalls, 0);

    const count = /** @type {{ n: number }} */ (
      db
        .prepare('SELECT COUNT(*) AS n FROM constraint_verdicts WHERE submission_id = ?')
        .get(submissionId)
    ).n;
    assert.equal(count, 0);
  } finally {
    db.close();
  }
});

test('pass verdicts enter review queue according to samplePassRate while unsure always enters queue', async () => {
  const db = open(':memory:');
  try {
    const { labId } = seedLabWithConstraints(db);
    const s1 = enqueueSubmission(db, { labId, studentId: 4, code: 'int main() { return 0; }\n' });
    const s2 = enqueueSubmission(db, { labId, studentId: 5, code: 'int main() { return 0; }\n' });

    // s1: random 0.05 < 0.1 -> pass C1 sampled into review queue; C2 unsure (modelOff) -> in queue
    await runWorkerOnce(db, {
      modelOff: true,
      samplePassRate: 0.1,
      random: () => 0.05,
      judgeCode: async () => ({ status: 'accepted' }),
    });
    // s2: random 0.5 >= 0.1 -> pass C1 NOT in queue; C2 unsure -> in queue
    await runWorkerOnce(db, {
      modelOff: true,
      samplePassRate: 0.1,
      random: () => 0.5,
      judgeCode: async () => ({ status: 'accepted' }),
    });

    const v1 = /** @type {Array<{ verdict: string, in_queue: number }>} */ (
      db
        .prepare(
          'SELECT verdict, in_queue FROM constraint_verdicts WHERE submission_id = ? ORDER BY constraint_id ASC',
        )
        .all(s1.submissionId)
    );
    const v2 = /** @type {Array<{ verdict: string, in_queue: number }>} */ (
      db
        .prepare(
          'SELECT verdict, in_queue FROM constraint_verdicts WHERE submission_id = ? ORDER BY constraint_id ASC',
        )
        .all(s2.submissionId)
    );
    assert.deepEqual(v1, [
      { verdict: 'pass', in_queue: 1 },
      { verdict: 'unsure', in_queue: 1 },
    ]);
    assert.deepEqual(v2, [
      { verdict: 'pass', in_queue: 0 },
      { verdict: 'unsure', in_queue: 1 },
    ]);
  } finally {
    db.close();
  }
});
