# Testing rules

> Use the smallest test that proves a Qubu-owned behavior. Use a live database only when the database boundary is part of that behavior.

## Start with the promise

Every test must protect a behavior that a Qubu user or developer can observe.
Before writing one, name that behavior in a sentence:

> A PostgreSQL query containing `ilike()` renders and executes through the
> adapter, returning the expected rows.

That sentence gives the test its scope. It does not need to prove every detail
of PostgreSQL's implementation.

## Choose the smallest test layer

| Layer                   | Use it for                                      | What to assert                                 |
| ----------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Type contract           | Types, inference, and invalid calls             | Compile-time success or `@ts-expect-error`     |
| Deterministic unit/fake | SQL, parameters, normalization, and diagnostics | Exact output or normalized data                |
| Live dialect E2E        | Actual database or driver compatibility         | Rows, bound values, mutations, or catalog data |

If a type or deterministic test can catch the regression, use it instead of a
live database. Use fake adapters or catalog connections for query mapping,
normalization, and diagnostics. Live E2E should validate compatibility with an
actual engine or driver, not repeat a string assertion.

## Runtime and type-test conventions

- Use `test()`, not `it()`.
- Name tests after the behavior they cover. Start with an active verb or a
  concrete subject, such as `renders MySQL identifiers` or `executes a bound
JSON query`.
- Put type-checking tests in files ending with `-d.ts`.
- When explicitly asked to set up a test file without implementing its
  behavior yet, mark the placeholder cases with `.skip`. Never use `.skip` to
  hide a failing or flaky test; implement or remove the placeholder before
  treating the coverage as complete.
- Keep runtime fixtures close to the test that owns them. Share a fixture only
  when several tests need the same behavior and changing it should affect all
  of them.
- Make tests independent. A test must arrange its own rows and must not depend
  on the order in which another test ran.
- Prefer observable results over implementation details. Test a diagnostic's
  code and path, for example, rather than a private helper call.

## Live dialect E2E tests

The database is a fixture for Qubu's adapter and introspection boundaries. The
current suite lives in `test/e2e/dialects.test.ts` and runs for every supported
live dialect in the `dialect-e2e` CI matrix: SQLite, PostgreSQL, and MySQL.
Standard SQL has no server target, so its coverage stays in render and type
tests.

An E2E test may use raw SQL to create, clear, and remove a small fixture schema.
That SQL prepares or cleans up the environment; it is not a test of DDL
generation. The behavior under test should use Qubu to build and execute the
query or read the catalog.

Good E2E coverage looks like this:

- bind values through `execute()` and verify the returned rows;
- exercise a dialect-specific feature such as JSON extraction, pagination, or
  `RETURNING` where that dialect supports it;
- verify that a mutation changes the row that Qubu targeted;
- read a live catalog and assert the normalized Qubu table, column, constraint,
  or diagnostic data.

Avoid these cases:

- exhaustive CRUD combinations that unit tests already cover;
- testing whether the database engine implements its own SQL features;
- asserting exact SQL formatting in a live test;
- testing driver-library behavior that Qubu does not own;
- adding tests for DDL execution, migrations, transaction orchestration,
  pooling, retries, or authentication unless Qubu owns that behavior.

Keep each live fixture small and isolated. Use a distinctive table name,
clear it before each test, and remove it during teardown. Assert the smallest
result that proves the behavior. If a dialect has different syntax or result
semantics, give it a focused case instead of weakening a shared assertion.

## Adding coverage

When a feature changes:

1. Add a type contract if the change affects TypeScript acceptance or
   inference.
2. Add a deterministic unit, render, or fake-boundary test for output,
   normalization, and diagnostics.
3. Add E2E coverage only when a real database or catalog is needed to expose
   the regression.
4. Keep every supported live dialect in the CI matrix. Keep portable behavior
   in shared tests and put dialect-specific behavior in focused cases without
   weakening the shared assertion.

Before opening a change, ask:

- What Qubu promise does this test protect?
- Could a type or render test prove it more directly?
- Does the test assert an outcome rather than database internals?
- Can it run independently of the other tests?
- Does the supported-dialect matrix still cover every live dialect?
- Is any `.skip` limited to an explicitly requested scaffold?

## Useful commands

Run the checks used by CI with:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test -- --run
pnpm run build
```

Run the local SQLite E2E case with:

```bash
QUBU_E2E_DIALECT=sqlite pnpm run test:e2e
```

PostgreSQL and MySQL E2E cases require their service containers. CI starts
those containers and sets the connection environment for each matrix entry.
