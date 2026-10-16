# Repository workflow: `main` vs `testing`

> Check the current branch (`git branch --show-current`) and follow the
> matching section below. The "Testing environment" rule applies on every
> branch.

Testing work is isolated from normal development. `main` is for product
development; the `testing` branch is the dedicated workspace for the test suite.

## On `main` (normal development)

- Do NOT run unit tests, integration tests, or the full suite (`pnpm test`,
  `vitest`, `npx vitest`) unless the user explicitly asks for testing.
- Do NOT add or modify tests unless explicitly asked.
- Do NOT investigate or fix unrelated test failures unless explicitly asked.
- For validation, use the minimum relevant checks: typecheck
  (`pnpm type-check`), build, and lint/static checks if applicable.
- Explicit testing requests look like: "run tests", "run the test suite",
  "add tests", "fix tests", "test this", "verify the tests".
- Product Roadmap updates (`implementation-plans/ROADMAP_Product.md`) are NOT
  test-related. Update them normally whenever the task requires it.

## On `testing`

- Testing is the primary scope: run the relevant tests, add/update/fix tests,
  maintain test infrastructure (`vitest.config.ts`, `test/` dirs, fixtures,
  helpers), and investigate failures.
- Run the appropriate level of tests for the task; not every task needs the
  whole suite.
- Keep test-related changes isolated to this branch where possible.
- Only touch the Product Roadmap if the testing task explicitly requires it.

## Testing environment (permanent rule)

- Run all tests and verification checks locally, against the development
  environment only.
- Never run tests, test scripts, verification suites, smoke tests, replays or
  drills on any server (production, staging or remote), and never SSH into a
  server to test or verify.
- If a check can only be performed on a server, do not run it: report it as
  not run and state the limitation.

## Production code and branch sync

- Production code stays shared; do not move app logic to `testing`. If a test
  needs a production change, assess it normally and keep the branches consistent.
- `testing` is based on `main`. Never merge `testing` into `main` (or `main`
  into `testing`) automatically; only synchronize when explicitly asked.

## Documentation

- `implementation-plans/ROADMAP_Product.md` is the single live product
  roadmap. Start there, then read only the documents the task needs; its
  "Working rules" section has the document map and the rules.
- Do not read every Markdown file or historical plan by default, and do not
  create a new document when an existing one can be updated.
- Task-specific plans are temporary: when the work is done, migrate what is
  still needed, update the roadmap, and remove the plan only if nothing
  (docs, source comments, scripts, CI) still depends on it.
- If the code conflicts with a documented decision, report the conflict
  before changing the decision; update the docs after approval.
- Never delete unresolved work, decisions, or required records (evidence,
  compliance, runbooks in use) to reduce the file count.
