import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, USERS } from '../../src/db.js';

test('open() without args uses in-memory db and seeds the 5 PA#3 accounts + stu3', () => {
  const db = open();
  try {
    const users = /** @type {Array<{ id: number, name: string, role: string, token: string }>} */ (
      db.prepare('SELECT id, name, role, token FROM users ORDER BY id').all()
    );
    assert.equal(users.length, USERS.length);
    assert.deepEqual(
      users.map((u) => u.name),
      ['admin', 'ta_a', 'ta_b', 'stu1', 'stu2', 'stu3'],
    );
    const staff = /** @type {Array<{ class_id: number, user_id: number }>} */ (
      db.prepare('SELECT class_id, user_id FROM class_staff ORDER BY class_id').all()
    );
    assert.deepEqual(
      staff.map((s) => ({ class_id: s.class_id, user_id: s.user_id })),
      [
        { class_id: 1, user_id: 2 },
        { class_id: 2, user_id: 3 },
      ],
    );
  } finally {
    db.close();
  }
});

test('open(filePath) persists data across restarts without re-seeding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'leetkob-db-'));
  const file = join(dir, 'nested', 'leetkob.db');
  try {
    const db1 = open(file);
    db1
      .prepare('INSERT INTO labs (class_id, title, statement) VALUES (?, ?, ?)')
      .run(1, 'Sort merge', 'Implement merge sort');
    const labId = /** @type {{ id: number }} */ (
      db1.prepare('SELECT last_insert_rowid() AS id').get()
    ).id;
    db1
      .prepare(
        'INSERT INTO constraints (lab_id, code, text, kind, deduction) VALUES (?, ?, ?, ?, ?)',
      )
      .run(labId, 'C1', 'Do not use `std::sort`', 'hard', 3);
    db1.close();

    const db2 = open(file);
    try {
      const lab = /** @type {{ title: string, statement: string } | undefined} */ (
        db2.prepare('SELECT title, statement FROM labs WHERE id = ?').get(labId)
      );
      assert.equal(lab?.title, 'Sort merge');
      assert.equal(lab?.statement, 'Implement merge sort');
      const users = /** @type {{ n: number }} */ (
        db2.prepare('SELECT COUNT(*) AS n FROM users').get()
      );
      assert.equal(users.n, USERS.length);
    } finally {
      db2.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PA#3 schema tables enforce uniqueness and check constraints', () => {
  const db = open();
  try {
    const { id: subId } = /** @type {{ id: number }} */ (
      db
        .prepare('INSERT INTO submissions (lab_id, student_id, verdict) VALUES (?, ?, ?)')
        .run(1, 4, 'unsure') && db.prepare('SELECT last_insert_rowid() AS id').get()
    );
    db.prepare('INSERT INTO submission_details (submission_id, code, status) VALUES (?, ?, ?)').run(
      subId,
      'int main() {}',
      'queued',
    );
    db.prepare('INSERT INTO judge_jobs (submission_id) VALUES (?)').run(subId);

    assert.throws(
      () => db.prepare('INSERT INTO judge_jobs (submission_id) VALUES (?)').run(subId),
      /UNIQUE/i,
    );
    assert.throws(
      () =>
        db
          .prepare('INSERT INTO constraints (lab_id, code, text, kind) VALUES (?, ?, ?, ?)')
          .run(1, 'C1', 'Bad kind', 'unknown'),
      /CHECK/i,
    );
  } finally {
    db.close();
  }
});
