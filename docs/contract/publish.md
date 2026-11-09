# `POST /api/labs/{labId}/publish` — contract

LeeTKOB · PA#2 · team 23120225-23120226-23120229 · frozen 2026-11-09

Publishes a lab's grades to its students. **There is no undo.** This is the human gate of
LeeTKOB: the step a TA takes after reviewing the model's verdicts, and nobody else.

This file is the specification. `test/contract/publish.contract.test.js` checks the code
against it, one test per promise, named after the section it checks. If the code and this
file disagree, the code is wrong. If this file is wrong, change it in its own pull request
that says why — never in the same commit as the code or the tests.

## 1. Conventions

- The path prefix is `/api`. Responses are JSON, UTF-8.
- Ids are positive integers. A `labId` that is not one (`0`, `-1`, `abc`, `1.5`) is treated
  as a lab that does not exist (§2, `not-found`).
- Timestamps are ISO 8601 strings in UTC with second precision, e.g.
  `2026-11-05T03:20:11Z`.
- Authentication is a bearer token: `Authorization: Bearer <token>`. Tokens are issued by the
  sign-in flow, which is not part of this contract.
- Clients ignore response fields they do not know. The server ignores a request body and
  query parameters on this endpoint.

## 2. Errors

Every `4xx` and `5xx` response is a **problem details** object (RFC 9457) with
`Content-Type: application/problem+json`:

```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://leetkob.example/problems/reviews-pending",
  "title": "Reviews pending",
  "status": 409,
  "detail": "2 submissions still need a TA decision",
  "pending": 2
}
```

| Member | Rule |
|---|---|
| `type` | `https://leetkob.example/problems/` followed by a slug from the table below. No other values |
| `title` | the title from the table below, exactly |
| `status` | a number, equal to the HTTP status of the response |
| `detail` | one sentence about this occurrence, for humans. Never a stack trace, an SQL message, a table name, a file path, or the name of a student |
| `pending` | only on `reviews-pending`: an integer ≥ 1, the number of pending submissions (§4.3) |

| Slug | Status | Title | When |
|---|---|---|---|
| `unauthenticated` | 401 | Unauthenticated | no `Authorization` header, a header that is not `Bearer <token>`, or a token the server does not know |
| `forbidden` | 403 | Forbidden | the caller is a student enrolled in the lab's class |
| `not-found` | 404 | Not found | no lab with that id, an id that is not a positive integer, **or** a lab the caller may not see (§3) |
| `reviews-pending` | 409 | Reviews pending | the lab is not published yet and at least one submission is pending (§4.3) |
| `internal` | 500 | Internal error | anything else. `detail` is the fixed sentence `Something went wrong on our side.` |

- A `401` also carries the header `WWW-Authenticate: Bearer`.
- Clients decide what to do from `type` (and `status`), never from `title` or `detail`.
- **A refused call changes nothing**: after any `4xx` or `5xx`, the lab's `publishedAt` is
  exactly what it was before the call.

## 3. Who may call it — roles and ownership

LeeTKOB has three roles: `admin`, `ta`, `student`. A lab belongs to one class. A TA is on the
staff of zero or more classes; a student is enrolled in zero or more classes.

| Caller | Result |
|---|---|
| no token, or a token we do not know | `401 unauthenticated` |
| an `admin` | allowed, for every lab |
| a `ta` **on the staff of the lab's class** | allowed |
| a `student` **enrolled in the lab's class** | `403 forbidden` — they already know the lab exists |
| anyone else: a TA of another class, a student of another class | `404 not-found`, with **the same body** as a lab that does not exist |

The ownership rule is checked on the server, from the lab's class, on every call. Hiding the
button in the page is not a check.

## 4. The endpoint

### 4.1 Request

```http
POST /api/labs/{labId}/publish
Authorization: Bearer <token>
```

| Part | Rule |
|---|---|
| `labId` (path) | positive integer; anything else is `404 not-found` |
| `Authorization` (header) | required, `Bearer <token>` |
| body | none. A body, if sent, is ignored |

### 4.2 Response `200 OK`

`Content-Type: application/json`

```json
{ "lab": 2, "publishedAt": "2026-11-05T03:20:11Z" }
```

| Field | Rule |
|---|---|
| `lab` | integer, equal to `labId` |
| `publishedAt` | ISO 8601 UTC timestamp (§1): when the lab was **first** published |

The status is `200` both for the call that publishes and for every repeat (§4.4).

### 4.3 Order of checks

The server checks in this order and stops at the first step that fails:

1. The caller is authenticated, else `401 unauthenticated`.
2. The lab exists and the caller is allowed to publish it (§3), else `403 forbidden` or
   `404 not-found`.
3. The lab is already published → `200` with the stored `publishedAt` (§4.4). Nothing else
   is checked and nothing changes.
4. No submission of the lab is **pending**, else `409 reviews-pending` with `pending` = the
   number of pending submissions. A submission is pending when its verdict is `violation` or
   `unsure` and it has no TA decision (`confirm` or `overturn`). A `pass` is never pending.
5. The lab is published: `publishedAt` is set to the current time, `200`.

Steps 4 and 5 are one atomic operation: a review that is reset or added between the check
and the write cannot slip past it.

### 4.4 Idempotency — safe to repeat

Publishing is idempotent by its nature; no `Idempotency-Key` header is needed or read.

- Calling it again on a published lab returns `200` with the **same** `publishedAt`. It does
  not publish again and does not move the time.
- Two calls that arrive at the same time (a double click, a retry after a timeout) publish
  the lab **once**: both get `200` and the same `publishedAt`.
- Once published, a lab stays published. Nothing in this API unpublishes it.

## 5. Versions — what happens when it changes

- Within this path, only **additive** changes are made without notice: a new response field,
  a new optional header, a new problem `type`. Clients must ignore fields they do not know,
  and treat an unknown `type` by its `status`.
- Anything else is breaking: renaming or removing a field, changing the timestamp format,
  changing a status code or a `type`, a new required header, a new reason to refuse. A
  breaking change gets a new path, `/api/v2/labs/{labId}/publish`. The old path keeps its own
  behaviour, errors included, and announces its end with `Deprecation` (RFC 9745) and
  `Sunset` (RFC 8594) headers at least 14 days before it is removed.
- A change to this file is made in its own pull request, reviewed by a human before the code
  changes. Its history is the change log.
