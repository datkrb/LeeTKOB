import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Seeded accounts (5 PA#3 test accounts: admin, ta_a, ta_b, stu1, stu2; plus stu3 for class 2):
//
//   class 1  TA: ta_a  students: stu1, stu2  lab 1
//     submission 1  stu1  violation  not reviewed yet  -> lab 1 cannot be published yet
//     submission 2  stu2  pass       needs no review
//   class 2  TA: ta_b  students: stu3        lab 2
//     submission 3  stu3  violation  already reviewed  -> lab 2 can be published
//   admin: every class
export const USERS = [
  { id: 1, name: 'admin', role: 'admin', token: 'tok-admin' },
  { id: 2, name: 'ta_a', role: 'ta', token: 'tok-ta-a' },
  { id: 3, name: 'ta_b', role: 'ta', token: 'tok-ta-b' },
  { id: 4, name: 'stu1', role: 'student', token: 'tok-stu1' },
  { id: 5, name: 'stu2', role: 'student', token: 'tok-stu2' },
  { id: 6, name: 'stu3', role: 'student', token: 'tok-stu3' },
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'ta', 'student')),
  token TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS class_staff (
  class_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS enrollments (
  class_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS labs (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  statement TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS lab_tests (
  id INTEGER PRIMARY KEY,
  lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  input TEXT NOT NULL,
  expected_output TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS constraints (
  id INTEGER PRIMARY KEY,
  lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('hard', 'semantic')),
  deduction REAL NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  UNIQUE (lab_id, code)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  lab_id INTEGER NOT NULL REFERENCES labs(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'violation', 'unsure')),
  decision TEXT CHECK (decision IN ('confirm', 'overturn'))
);
CREATE TABLE IF NOT EXISTS submission_details (
  submission_id INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'judging', 'accepted', 'failed', 'error')),
  compile_output TEXT,
  judge_output TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  judged_at TEXT
);
CREATE TABLE IF NOT EXISTS constraint_verdicts (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  constraint_id INTEGER NOT NULL REFERENCES constraints(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'violation', 'unsure')),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  decision TEXT CHECK (decision IN ('confirm', 'overturn')),
  in_queue INTEGER NOT NULL DEFAULT 0 CHECK (in_queue IN (0, 1)),
  UNIQUE (submission_id, constraint_id)
);
CREATE TABLE IF NOT EXISTS judge_jobs (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  finished_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS llm_call_logs (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER REFERENCES submissions(id) ON DELETE SET NULL,
  constraint_id INTEGER REFERENCES constraints(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_id TEXT,
  prompt TEXT NOT NULL,
  response_text TEXT,
  prompt_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  cost_usd REAL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'timeout', 'schema_error', 'error')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
`;

function seed(db) {
  const u = db.prepare('INSERT INTO users (id, name, role, token) VALUES (?, ?, ?, ?)');
  for (const x of USERS) u.run(x.id, x.name, x.role, x.token);
  db.exec(`
    INSERT INTO class_staff VALUES (1, 2), (2, 3);
    INSERT INTO enrollments VALUES (1, 4), (1, 5), (2, 6);
    INSERT INTO labs (id, class_id, title) VALUES (1, 1, 'Merge sort'), (2, 2, 'Merge sort');
    INSERT INTO submissions (id, lab_id, student_id, verdict, decision) VALUES
      (1, 1, 4, 'violation', NULL),
      (2, 1, 5, 'pass', NULL),
      (3, 2, 6, 'violation', 'confirm');
  `);
}

/** @param {string} [dbPath] */
export function open(dbPath = ':memory:') {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const { n } = /** @type {{ n: number }} */ (db.prepare('SELECT COUNT(*) AS n FROM users').get());
  if (n === 0) seed(db);
  return db;
}
