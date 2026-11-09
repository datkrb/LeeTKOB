// Start the slice in-process on a fresh in-memory database.
import { open } from '../src/db.js';
import { createApp } from '../src/app.js';

export async function startApp(db = open()) {
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;

  // A raw call: the test chooses every header, so it can send a broken one.
  /** @param {string} method @param {string} path @param {{ headers?: Record<string, string>, body?: string }} [init] */
  async function raw(method, path, { headers = {}, body } = {}) {
    const res = await fetch(base + path, { method, headers, body });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: res.status,
      type: res.headers.get('content-type'),
      headers: res.headers,
      body: json,
      text,
    };
  }

  function as(user) {
    const headers = user ? { authorization: `Bearer tok-${user.replace('_', '-')}` } : {};
    const call = (method, path, body) =>
      raw(method, path, {
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body) };
  }

  const publishedAt = (lab) =>
    /** @type {{ t: string | null } | undefined} */ (
      db.prepare('SELECT published_at AS t FROM labs WHERE id = ?').get(lab)
    )?.t ?? null;

  return { as, raw, db, publishedAt, close: () => new Promise((r) => server.close(r)) };
}
