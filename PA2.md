# PA#2 — Harness and quality gate (LeeTKOB)

Team 23120225 (Trần Gia Cường) · 23120226 (Nguyễn Ngọc Đại) · 23120229 (Nguyễn Hà Đạt).
Submitted commit: tag `pa2`.

## Links

| What | Link |
|---|---|
| Repository (public) | https://github.com/datkrb/LeeTKOB |
| Protected-branch settings (screenshots, 2026-11-09) | [pattern `main`](docs/evidence/protection-1-pattern.jpg) · [PR required, status checks required, up to date](docs/evidence/protection-2-pr-and-checks.jpg) · [required: `gates`, `e2e`, `secrets`](docs/evidence/protection-3-required-checks.jpg) · [no bypass, no force push, no deletion](docs/evidence/protection-4-no-bypass.jpg) |
| Protection, machine-readable (public API) | https://api.github.com/repos/datkrb/LeeTKOB/branches/main → `"enforcement_level":"everyone","contexts":["gates","e2e","secrets"]` |
| Blocked PR: a red required check stopped the merge | [PR #1](https://github.com/datkrb/LeeTKOB/pull/1) at commit [`3765466`](https://github.com/datkrb/LeeTKOB/commit/3765466) — red run [42645322799](https://github.com/datkrb/LeeTKOB/actions/runs/42645322799) |
| The commit that turned it green | [`a44a60b`](https://github.com/datkrb/LeeTKOB/commit/a44a60b) — green run [42645500132](https://github.com/datkrb/LeeTKOB/actions/runs/42645500132); then merged |
| A second red → green PR (contract first) | [PR #2](https://github.com/datkrb/LeeTKOB/pull/2): red at [`d5ef744`](https://github.com/datkrb/LeeTKOB/commit/d5ef744) ([run](https://github.com/datkrb/LeeTKOB/actions/runs/42646239801), 15 of 22 contract tests failing), green at [`bc121cd`](https://github.com/datkrb/LeeTKOB/commit/bc121cd) ([run](https://github.com/datkrb/LeeTKOB/actions/runs/42646401549)) |
| Deliberate contract break that CI caught | [PR #4](https://github.com/datkrb/LeeTKOB/pull/4), commit [`d2edf33`](https://github.com/datkrb/LeeTKOB/commit/d2edf33): `gates` red in [run 42647921823](https://github.com/datkrb/LeeTKOB/actions/runs/42647921823), merge blocked, left unmerged |
| CI run for the tag `pa2` | https://github.com/datkrb/LeeTKOB/actions/workflows/ci.yml?query=branch%3Apa2 (the workflow runs on tag pushes; the run appears there once the tag is pushed) |
| Contract | [`docs/contract/publish.md`](docs/contract/publish.md) — `POST /api/labs/{labId}/publish` |
| Contract tests | [`test/contract/publish.contract.test.js`](test/contract/publish.contract.test.js) — 22 tests, run by `npm run contract` inside the required `gates` job |
| Rules file | [`AGENTS.md`](AGENTS.md) (imported by [`CLAUDE.md`](CLAUDE.md)) |
| Permissions, three tiers | [`docs/permissions.md`](docs/permissions.md), enforced by [`.claude/settings.json`](.claude/settings.json) |

## What happened, in order

1. **The starter's gate could not fail.** Its workflow ran only on pushes to `main`, on Node 20,
   with `continue-on-error` on lint and `npm test || true`; it never ran the format check or the
   contract tests. Its run on `main` was green: [run 42452347978](https://github.com/datkrb/LeeTKOB/actions/runs/42452347978).
2. **PR #1 made it honest** (`ebcb3bc`): `npm ci` + `npm run check` on every PR, Node from
   `package.json`. It went red on the lint error the old workflow hid (the first red run,
   [42452389227](https://github.com/datkrb/LeeTKOB/actions/runs/42452389227), is on the
   pre-rewrite SHA `6a0f5d3`, see AI-LOG 2026-11-09). Fixed in `db9a4cb`. On the way we found
   that a Windows clone failed `format:check` on 13 files that CI passed (CRLF) — `.gitattributes`
   in `b4d1471`.
3. **`main` protected** once `gates` had run: PR required, `gates` required, branches up to
   date, no bypass for administrators. A direct push was then rejected:

   ```text
   remote: - Changes must be made through a pull request.
   remote: - Required status check "gates" is expected.
    ! [remote rejected] main -> main (protected branch hook declined)
   ```

4. **Tests that could not fail, made strict** (`3765466`, test only): the pending-review test
   was wrapped in `try/catch`; the "TA of another class" test checked only the status. PR #1 went
   red with the merge button disabled. **Fix in `src/` only** (`a44a60b`): the starter wrote
   `published_at` before its permission check, and never refused while reviews were pending.
   Green; merged.
5. **PR #2, contract first:** `05c2722` the contract alone, `d5ef744` the tests alone (red, 15 of
   22), `bc121cd` the code alone (green). Merged.
6. **PR #3, harness:** type check (`tsc --checkJs`) added to `npm run check`, `e2e` and `secrets`
   jobs, rules file, permissions, `.env.example`, README. Then `e2e` and `secrets` were made
   required too. Merged.
7. **PR #4, deliberate break:** delete the pending-review clause from the publish `UPDATE`. The
   contract tests `§4.3 it refuses while reviews are pending…` and `§4.3 an unsure verdict…`
   failed, `gates` went red, the merge stayed blocked. Note: the `e2e` job stayed green — its
   journey reviews before publishing, so it cannot see this break. That is why the rule is
   pinned by contract tests, not by the browser test.
8. **PR #5:** this file, `AI-LOG.md`, `SELF_ASSESSMENT_REPORT.md`; then the tag `pa2`.

Since protection was turned on, every change reached `main` through a pull request
(#1, #2, #3, #5); nothing was pushed straight to `main`.

## Reproduce

```bash
git clone https://github.com/datkrb/LeeTKOB.git && cd LeeTKOB
git checkout pa2
npm ci
npm run check        # lint, format, types, 5 unit tests, 22 contract tests
```

Checked on 2026-11-09 from a fresh clone on Windows 11 / Node 22.21.0: all green.
