# LeeTKOB — rules for the coding assistant

Read by Codex (`AGENTS.md`) and Claude Code (`CLAUDE.md` imports this file). Keep it short.
A line marked *(why: …)* exists because something actually went wrong.

## Stack

- Node.js ≥ 22.13, ES modules, no web framework: `node:http`, `node:sqlite` (in-memory for now).
- Tests: `node:test`. Browser: Playwright (CI only). Lint: ESLint 9. Format: Prettier 3.
  Types: TypeScript `checkJs` over the JavaScript, no build step.
- Contract of the endpoint we own: `docs/contract/publish.md`. Product: the LeeTKOB class brief.

## Commands

All of them are what CI runs (`.github/workflows/ci.yml`). Run `npm run check` before every push.

```bash
npm ci                # install exactly the lockfile
npm run check         # lint + format:check + typecheck + test + contract: THE gate
npm run lint          # ESLint
npm run format:check  # Prettier (npx prettier --write . to fix)
npm run typecheck     # tsc --checkJs
npm test              # unit tests, test/unit
npm run contract      # contract tests, test/contract
npm run e2e           # Playwright journey (needs: npx playwright install chromium)
```

## Conventions

- Contract first. A change of behaviour starts in `docs/contract/*.md` in its own commit; tests
  next, in their own commit; code last. Contract test names start with the `§` they check.
- Every error is RFC 9457 problem details through `problem()` in `src/http.js`; one fixed title
  per `type`. A `500` says only the fixed sentence.
- Check who may call (role + the class the lab belongs to) **before any write**: a refused call
  changes nothing. *(why: the starter set `published_at` before its permission check, so a 403
  still published — fixed in a44a60b.)*
- Small pull requests into `main`; `main` is protected and needs the `gates`, `e2e` and
  `secrets` checks. Commit messages: what changed and why, in the imperative.
- Commits are authored by the team member only: no `Co-Authored-By` trailer for the assistant.
  AI use is declared in `AI-LOG.md` instead. *(why: the student rejected such trailers on
  2026-11-09; five commits were rewritten before merge — see AI-LOG.)*
- Files use LF (`.gitattributes`). *(why: on Windows `format:check` failed on 13 files that
  CI passed — b4d1471.)*

## Never

- Never put a secret in the repository, a prompt, a log or a test. Real values live only in
  `.env` (ignored); `.env.example` lists names without values.
- Never make the model API key (or any secret) visible inside the judging sandbox — not in its
  environment, files or mounts. Student code is hostile.
- Never call a real model in unit or contract tests; use a stub. Only the eval job may call it.
- Never send student names, student IDs or comments to the model: statement, constraints and
  stripped code only.
- Never edit a test, the eval data, a label or a threshold to make a check pass. A red test
  means the code is wrong; if the contract is wrong, change the contract first, in its own PR.
  *(why: the starter hid a failing contract test inside `try/catch` — made strict in 3765466.)*
- Never make CI unable to fail: no `|| true`, no `continue-on-error`, no skipped or `.only`
  tests. *(why: the starter workflow did both and stayed green on a broken build — ebcb3bc.)*
- Never push to `main`, force-push a shared branch, change branch protection, or tag a release
  without asking (see `docs/permissions.md`).
