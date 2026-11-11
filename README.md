# LeeTKOB — harness and quality gate

CSC13114 Advanced Web Application Development · HK1 2026–2027 · team
23120225 (Trần Gia Cường) · 23120226 (Nguyễn Ngọc Đại) · 23120229 (Nguyễn Hà Đạt).

LeeTKOB is the class project: a TA reviews the model's constraint verdicts on Accepted C++
submissions, then publishes the lab's marks. This repository starts from the session 7 starter
(`fithcmus/awad-quality-gate-starter`): a slice with the TA's review queue and the
**Publish grades** step. Its contract is [`docs/contract/publish.md`](docs/contract/publish.md).
PA#2 evidence: [`PA2.md`](PA2.md).

## Run the checks — locally and in CI, the same commands

Node 22.13 or newer, Git.

```bash
git clone https://github.com/datkrb/LeeTKOB.git
cd LeeTKOB
npm ci
npm run check
```

`npm run check` is the gate. It runs, in order, and stops at the first failure:

| Check | Command | What |
|---|---|---|
| Lint | `npm run lint` | ESLint 9 |
| Format | `npm run format:check` | Prettier 3 (`npx prettier --write .` fixes) |
| Types | `npm run typecheck` | TypeScript `checkJs` over the JavaScript |
| Unit tests | `npm test` | `test/unit`, pure logic |
| Contract tests | `npm run contract` | `test/contract`, one test per promise of the contract |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every pull request, on pushes
to `main` and on tags. Its job `gates` runs exactly `npm ci` + `npm run check` on the Node version
from `package.json`. Two more jobs:

- `e2e` — `npx playwright install --with-deps chromium` then `npm run e2e`: a TA reviews and
  publishes in a real browser. Locally it needs `npx playwright install chromium` once.
- `secrets` — gitleaks over the whole git history. Locally, with Docker:
  `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.21.2 git /repo`.

`main` is protected: changes arrive only by pull request, and `gates`, `e2e` and `secrets` must
pass; administrators cannot bypass it.

Windows: `.gitattributes` checks files out with LF, so `format:check` passes on a fresh clone. A
clone made before that commit needs `git rm --cached -r . && git reset --hard` once.

`npm start` serves the slice on http://localhost:3007 with an in-memory database that resets on
every start. The seeded tokens (`tok-admin`, `tok-ta-a`, …) are demo values printed at start-up,
not secrets.

## Secrets and the model

- `.env` is git-ignored. [`.env.example`](.env.example) lists every variable, without values.
  Today the server reads only `PORT`.
- **Model: Google Gemini, `gemini-2.5-flash`, free tier.** The team's API key belongs to a
  Google AI Studio project **with no billing account attached**, so it cannot incur any charge:
  the spending cap is **0 USD**. Requests over the free-tier rate limits are refused by Google,
  not billed. The key lives only in each member's local `.env` (`LLM_API_KEY`), never in the
  repository, a prompt or CI. If we ever attach billing (PA#3 or later), we set a budget cap at
  the provider first and update this paragraph with the cap and the measured cost of one lab.
- **What one lab costs:** 0 USD on the free tier. Nothing in this repository calls the model
  yet; the constraint checker arrives in PA#3, and the app's own cap per lab
  (`LLM_MAX_USD_PER_LAB`) will be enforced there.
- The assistant's permissions (allowed / ask first / never) are in
  [`docs/permissions.md`](docs/permissions.md) and enforced for Claude Code by
  [`.claude/settings.json`](.claude/settings.json). Rules for the assistant: [`AGENTS.md`](AGENTS.md).

## Files

| Path | What it is |
|---|---|
| `docs/contract/publish.md` | the contract of `POST /api/labs/{labId}/publish` |
| `src/app.js`, `src/http.js` | the routes and the problem-details helper |
| `src/grades.js` | pure logic, unit tested |
| `test/unit/`, `test/contract/`, `e2e/` | the three layers of the pyramid |
| `AGENTS.md`, `CLAUDE.md`, `docs/permissions.md` | rules and permissions of the coding assistant |
| `PA2.md`, `AI-LOG.md`, `SELF_ASSESSMENT_REPORT.md` | PA#2 submission |
