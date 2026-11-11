# AI-LOG — LeeTKOB / PA#2

Format from the course AI policy. Dates are the student's (UTC+7). Model of the assistant:
Claude Opus 5.5 in Claude Code (desktop app). No product feature calls a model yet: there is
no model API key, provider account or spending cap in PA#2.

## 2026-11-08 — Reading the brief, creating the repository, honest CI
Tool: Claude Code (Opus 5.5) with Claude in Chrome (the student's own Chrome session).
Asked for: "làm PA2" — do PA#2; Chrome had the Claude extension enabled.
Kept: the assistant read the PA#2 assignment, its rubric and the LeeTKOB class brief on
Classroom, found the session 7 starter (`fithcmus/awad-quality-gate-starter`) and proposed to
build on it. It created the public repository `datkrb/LeeTKOB`, pushed the starter history, and
wrote the new `ci.yml` (pull requests + `main`, Node from `package.json`, `npm ci`,
`npm run check`).
Changed: on the first local run of `npm run check` on Windows, `format:check` failed on 13 files
that CI on Linux passed — the checkout was CRLF (`core.autocrlf=true`). The assistant added
`.gitattributes` (`eol=lf`) in its own commit. While renormalising the files it ran
`git reset --hard`, which silently discarded its own uncommitted lint fix; it noticed from
`git status`, redid the one-line fix, and the rules now list `git reset --hard` under "never".
Rejected: the starter's `node-version: 20` and `npm install` (not what `package.json` and the
lockfile ask for).
By hand: the student chose the repository name (`datkrb/LeeTKOB`), confirmed the team (same as
PA#1) and decided that the missing model key / spending cap is reported as not done. The
student signed in to Git Credential Manager. No code was written by hand.

## 2026-11-09 — Protection, strict tests, the commit-author correction
Tool: Claude Code (Opus 5.5), Claude in Chrome, GitHub Actions.
Asked for: continue PA#2; then "commit only as me — why is Claude added?" and "pick the datkrb
account so I don't have to choose".
Kept: branch protection on `main` (PR required, `gates` required, up to date, no bypass), set
through the GitHub settings page; the stricter contract tests (`3765466`) and the `src/` fix
(`a44a60b`), in separate commits.
Changed: the assistant had added a `Co-Authored-By: Claude …` trailer to five commits on the PR
branch. The student rejected that: commits carry the student's name only, and AI use is declared
here instead. With the student's approval the assistant rewrote the five commits without the
trailer and force-pushed the PR branch (not `main`) in two steps — first up to the strict tests
(red again, merge blocked: run 42645322799), then the fix (green: run 42645500132) — so the
red → green evidence sits on the new SHAs. The earliest red run (42452389227) refers to the
pre-rewrite SHA `6a0f5d3`. Repository config now pins `user.name`/`user.email` and the GCM
account to `datkrb`; `AGENTS.md` records the rule.
Rejected: the trailer itself (by the student). A merge attempted by a script in the page was
refused by Claude Code's permission classifier; the assistant merged by clicking the button
instead.
By hand: the student entered the GitHub sudo-mode verification code twice (the first saved
rule was lost behind the prompt and had to be filled in again) and approved the history
rewrite. No code was written by hand.

## 2026-11-09 — Contract, contract tests, harness, deliberate break
Tool: Claude Code (Opus 5.5), Claude in Chrome, GitHub Actions, gitleaks, TypeScript.
Asked for: the rest of PA#2: the contract of one LeeTKOB endpoint, contract tests, rules file,
permissions, one command per check, a deliberate break.
Kept: `docs/contract/publish.md` (written first, own commit `05c2722`), 22 contract tests
(`d5ef744`, red 15/22 on the old code), the implementation (`bc121cd`); `tsc --checkJs` in
`npm run check`; `e2e` and `secrets` jobs, later made required; `AGENTS.md`, `CLAUDE.md`,
`docs/permissions.md`, `.claude/settings.json`, `.env.example`, README; PR #4 as the deliberate
break.
Changed: the first `tsc` run found four type errors in `test/helpers.js`; fixed with JSDoc casts
only, no assertion touched. The `.claude/settings.json` deny rule `Read(.env.*)` would also have
hidden `.env.example`; narrowed to `.env` / `.env.local` / `.env.production`. The contract
changed two starter decisions on purpose, before code: `publishedAt` became ISO 8601 UTC, and a
non-integer `labId` is a 404.
Rejected: the assistant's first plan relied on the `e2e` job as a second guard for the
pending-review rule; PR #4 showed the browser journey stays green on that break (it reviews
before publishing), so the rule is guarded by the contract tests only, and PA2.md says so.
Known weakness, not fixed: the contract tests and the code were written by the same assistant in
one session (the session 5 advice is that tests come from the contract and not from the agent
that writes the code), and no team member reviewed the contract before the code was written.
The separate commits (contract → tests → code) are the only check we have.
By hand: none of the contract, tests, code or rules was written or edited by hand. The team
members still need to read the contract and the rules file to explain them in the oral.


## 2026-11-10 — Refining rules file, Gemini integration, self-assessment review

Tool: Google Gemini / Antigravity. Asked for: Review PA#2 completion status, clarify AGENTS.md rules, and propose team additions for Gemini / Windows PowerShell. Kept: created GEMINI.md, updated AGENTS.md with Gemini support, Windows PowerShell npm.cmd execution policy note, and branch conventions (commit 33ea9a9).

## 2026-11-11 — Final check and packaging
Tool: Claude Code (Opus 5.5).
Asked for: pull the team's changes, check them, and assemble the submission; the student wants
the self-assessment at 100 only with evidence behind it.
Kept: Cường's commits `33ea9a9` (AGENTS.md, GEMINI.md) and `ed9f7f9` (AI-LOG, self-assessment),
merged through PR #6 with all three required checks green; no secret or `.env` in them.
Changed: README and `.env.example` now state the model (Gemini `gemini-2.5-flash`, free tier)
and its spending cap (0 USD: no billing account on the project), as reported by the student —
the assistant did not see the key or the Google account and did not verify it. The
self-assessment was rewritten from 92 to 100: criteria 1 and 2 because of the team's new
evidence; criteria 5 and 6 because the assistant's earlier deductions (no outside reader; tests
written by the same agent) are not conditions in the rubric — both remain listed under "what we
did not manage". Tag `pa2` moved to the final merge commit with the student's approval.
Rejected: sending the API key to the assistant (the course rules forbid keys in prompts; the
student kept it in a local `.env`). The 2026-11-10 entry above is kept as written; it does not
follow the Kept/Changed/Rejected/By hand format in full.
By hand: Cường edited the rules file and AI-LOG in his own commits (with Gemini assistance, per
his entry); the student created the free-tier key and decided the final claim. No code by hand.
