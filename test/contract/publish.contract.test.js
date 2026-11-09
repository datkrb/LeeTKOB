// docs/contract/publish.md, as tests: one test per promise, named after its section.
// Written from the contract, over HTTP, without reading src/.
//
// Seed (src/db.js): class 1 — TA ta_a, students stu1 and stu2, lab 1 with one pending
// violation. Class 2 — TA ta_b, student stu3, lab 2 with nothing pending. admin sees all.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';
import { open } from '../../src/db.js';

const BASE = 'https://leetkob.example/problems/';
const TITLES = {
  unauthenticated: 'Unauthenticated',
  forbidden: 'Forbidden',
  'not-found': 'Not found',
  'reviews-pending': 'Reviews pending',
  internal: 'Internal error',
};
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

let app;
beforeEach(async () => {
  app = await startApp();
});
afterEach(() => app.close());

const publish = (user, lab) => app.as(user).post(`/api/labs/${lab}/publish`);
const publishWith = (headers, lab = 2) => app.raw('POST', `/api/labs/${lab}/publish`, { headers });

// §2: the shape every error shares.
function assertProblem(r, status, slug) {
  assert.equal(r.status, status, `status: ${r.text}`);
  assert.match(r.type, /^application\/problem\+json/);
  assert.equal(r.body.type, BASE + slug);
  assert.equal(r.body.title, TITLES[slug]);
  assert.equal(r.body.status, status);
  assert.equal(typeof r.body.detail, 'string');
  assert.ok(r.body.detail.length > 0);
}

// ---- §3 who may call it, §2 401 -------------------------------------------------------

test('§3 no token is 401 unauthenticated, with WWW-Authenticate: Bearer, and publishes nothing', async () => {
  const r = await publish(null, 2);
  assertProblem(r, 401, 'unauthenticated');
  assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer/);
  assert.equal(app.publishedAt(2), null);
});

test('§3 an unknown token is 401 unauthenticated and publishes nothing', async () => {
  const r = await publishWith({ authorization: 'Bearer tok-nobody' });
  assertProblem(r, 401, 'unauthenticated');
  assert.equal(app.publishedAt(2), null);
});

test('§2 a header that is not "Bearer <token>" is 401 unauthenticated', async () => {
  assertProblem(await publishWith({ authorization: 'tok-ta-b' }), 401, 'unauthenticated');
  assertProblem(await publishWith({ authorization: 'Basic dGE6Yg==' }), 401, 'unauthenticated');
  assert.equal(app.publishedAt(2), null);
});

test('§3 a student enrolled in the class is 403 forbidden and publishes nothing', async () => {
  assertProblem(await publish('stu3', 2), 403, 'forbidden');
  assert.equal(app.publishedAt(2), null);
});

test('§3 a TA of another class is 404, the same body as a missing lab, and publishes nothing', async () => {
  const other = await publish('ta_a', 2);
  const missing = await publish('ta_a', 99);
  assertProblem(other, 404, 'not-found');
  assert.deepEqual(other.body, missing.body);
  assert.equal(app.publishedAt(2), null);
});

test('§3 a student of another class is 404 not-found and publishes nothing', async () => {
  assertProblem(await publish('stu1', 2), 404, 'not-found');
  assert.equal(app.publishedAt(2), null);
});

test('§3 a refused call checks the caller before anything else: a student on a pending lab is 403, not 409', async () => {
  assertProblem(await publish('stu1', 1), 403, 'forbidden');
  assert.equal(app.publishedAt(1), null);
});

test('§3 the TA on the staff of the class publishes', async () => {
  const r = await publish('ta_b', 2);
  assert.equal(r.status, 200);
  assert.ok(app.publishedAt(2));
});

test('§3 an admin may publish any lab', async () => {
  assert.equal((await publish('admin', 2)).status, 200);
});

// ---- §4.1 request ----------------------------------------------------------------------

test('§4.1 a lab that does not exist is 404 not-found', async () => {
  assertProblem(await publish('admin', 99), 404, 'not-found');
});

test('§4.1 a labId that is not a positive integer is 404 not-found', async () => {
  for (const id of ['0', '-1', 'abc', '1.5', '2abc']) {
    assertProblem(await publish('admin', id), 404, 'not-found');
  }
  assert.equal(app.publishedAt(2), null);
});

test('§4.1 a body, if sent, is ignored', async () => {
  const r = await app.as('ta_b').post('/api/labs/2/publish', { lab: 1, publishedAt: 'x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.lab, 2);
});

// ---- §4.2 response ---------------------------------------------------------------------

test('§4.2 200 is application/json with lab and an ISO 8601 UTC publishedAt', async () => {
  const before = Date.now();
  const r = await publish('ta_b', 2);
  assert.equal(r.status, 200);
  assert.match(r.type, /^application\/json/);
  assert.equal(r.body.lab, 2);
  assert.match(r.body.publishedAt, ISO_UTC);
  const t = Date.parse(r.body.publishedAt);
  assert.ok(Math.abs(t - before) < 5000, 'publishedAt is the time of the call');
});

// ---- §4.3 order of checks: pending reviews --------------------------------------------

test('§4.3 it refuses while reviews are pending: 409 reviews-pending with pending, nothing published', async () => {
  const r = await publish('ta_a', 1);
  assertProblem(r, 409, 'reviews-pending');
  assert.equal(r.body.pending, 1);
  assert.equal(app.publishedAt(1), null);
});

test('§4.3 an unsure verdict without a decision is pending too, and pending counts every one', async () => {
  app.db.exec("INSERT INTO submissions VALUES (10, 1, 5, 'unsure', NULL)");
  const r = await publish('admin', 1);
  assertProblem(r, 409, 'reviews-pending');
  assert.equal(r.body.pending, 2);
  assert.equal(app.publishedAt(1), null);
});

test('§4.3 a pass is never pending', async () => {
  app.db.exec("INSERT INTO submissions VALUES (11, 2, 6, 'pass', NULL)");
  assert.equal((await publish('ta_b', 2)).status, 200);
});

test('§4.3 once every pending submission has a decision, the TA can publish', async () => {
  const review = await app.as('ta_a').post('/api/submissions/1/review', { decision: 'overturn' });
  assert.equal(review.status, 200);
  const r = await publish('ta_a', 1);
  assert.equal(r.status, 200);
  assert.match(r.body.publishedAt, ISO_UTC);
});

// ---- §4.4 idempotency ------------------------------------------------------------------

test('§4.4 publishing again returns 200 with the same publishedAt and does not move the time', async () => {
  const first = await publish('ta_b', 2);
  await new Promise((r) => setTimeout(r, 1100)); // timestamps have one-second resolution
  const again = await publish('ta_b', 2);
  assert.equal(again.status, 200);
  assert.equal(again.body.publishedAt, first.body.publishedAt);
  assert.equal(app.publishedAt(2), first.body.publishedAt);
});

test('§4.4 a repeat on a published lab is 200 even if another caller published it', async () => {
  const first = await publish('admin', 2);
  const again = await publish('ta_b', 2);
  assert.equal(again.status, 200);
  assert.equal(again.body.publishedAt, first.body.publishedAt);
});

test('§4.4 a double click publishes once: both get 200 and the same publishedAt', async () => {
  const [a, b] = await Promise.all([publish('ta_b', 2), publish('ta_b', 2)]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.publishedAt, b.body.publishedAt);
});

test('§4.4 a refused call on a published lab still changes nothing', async () => {
  const first = await publish('ta_b', 2);
  assertProblem(await publish('stu3', 2), 403, 'forbidden');
  assert.equal(app.publishedAt(2), first.body.publishedAt);
});

// ---- §2 internal errors ----------------------------------------------------------------

test('§2 an unexpected failure is 500 internal with the fixed sentence and no internals', async () => {
  const db = open();
  const broken = await startApp(db);
  try {
    db.exec('DROP TABLE submissions'); // the server now hits an SQL error while publishing
    const r = await broken.as('ta_b').post('/api/labs/2/publish');
    assertProblem(r, 500, 'internal');
    assert.equal(r.body.detail, 'Something went wrong on our side.');
    assert.doesNotMatch(r.text, /submissions|SQLITE|no such table|at .*\.js/i);
  } finally {
    await broken.close();
  }
});
