// No framework on purpose: every status code in the contract is visible in src/app.js.

const PROBLEM_BASE = 'https://leetkob.example/problems/';

export function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Each problem type has one fixed title (docs/contract/publish.md §2). Clients branch on type.
const TITLES = {
  unauthenticated: 'Unauthenticated',
  forbidden: 'Forbidden',
  'not-found': 'Not found',
  'invalid-body': 'Invalid request',
  'reviews-pending': 'Reviews pending',
  internal: 'Internal error',
};

// RFC 9457 problem details, the same error model as session 5.
export function problem(res, status, slug, detail, extra = {}) {
  const headers = { 'content-type': 'application/problem+json' };
  if (status === 401) headers['www-authenticate'] = 'Bearer';
  res.writeHead(status, headers);
  const title = TITLES[slug];
  res.end(JSON.stringify({ type: PROBLEM_BASE + slug, title, status, detail, ...extra }));
}

export async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
