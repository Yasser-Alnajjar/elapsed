# Repository workflow: `main` vs `testing`

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

## Production code and branch sync

- Production code stays shared; do not move app logic to `testing`. If a test
  needs a production change, assess it normally and keep the branches consistent.
- `testing` is based on `main`. Never merge `testing` into `main` (or `main`
  into `testing`) automatically; only synchronize when explicitly asked.
