# Testing Qubu

> Choose the smallest test that proves a Qubu-owned behavior, and use a real database only when the database boundary is part of that behavior.

## Start with the promise

Every test should protect a behavior a Qubu user can observe. Before writing
one, name that behavior in a sentence:

> A PostgreSQL query containing `ilike()` renders and executes through the
> adapter, returning the expected rows.

That sentence gives the test its scope. It does not need to prove every detail
of PostgreSQL's implementation.

## Choose the smallest test layer

| Layer               | Use it for                                                                       | What to assert                                                     |
| ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Type contract       | Inference, capability requirements, source scope, row shapes, and invalid calls  | A compile-time success or the expected `@ts-expect-error`          |
| Unit or render test | SQL text, parameter order, metadata normalization, diagnostics, and pure helpers | Exact output when formatting is the behavior under test            |
| Live dialect E2E    | Behavior that can fail only at the database boundary                             | Returned rows, bound values, mutations, or normalized catalog data |

If a type or render test can catch the regression, use it instead of a live
database. E2E tests cost more and tell us less when they only repeat a string
assertion.

## Runtime and type-test conventions

- Use `test()`, not `it()`.
- Name tests after the behavior they cover. Start with an active verb or a
  concrete subject, such as `renders MySQL identifiers` or `executes a bound
JSON query`.
- Put type-checking tests in files ending with `-d.ts`.
- Keep runtime fixtures close to the test that owns them. Share a fixture only
  when several tests need the same behavior and changing it should affect all
  of them.
- Make tests independent. A test must arrange its own rows and must not depend
  on the order in which another test ran.
- Prefer observable results over implementation details. Test a diagnostic's
  code and path, for example, rather than a private helper call.

## Live dialect E2E tests

The database is a fixture for Qubu's adapter and introspection boundaries. The
current suite lives in `test/e2e/dialects.test.ts` and runs for SQLite,
PostgreSQL, and MySQL through the `dialect-e2e` CI matrix. Standard SQL has no
server target, so its coverage stays in render and type tests.

An E2E test may use raw SQL to create a small fixture schema. That SQL prepares
the environment; it is not a test of DDL generation. The test itself should
use Qubu to build and execute the query or read the catalog.

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
- adding DDL, migration, transaction, or pooling tests when those remain
  outside Qubu's boundary.

Keep each live fixture small and isolated. Use a distinctive table name,
clear it before each test, and remove it during teardown. Assert the smallest
result that proves the behavior. If a dialect has different syntax or result
semantics, give it a focused case instead of weakening a shared assertion.

## Adding coverage

When a feature changes:

1. Add a type contract if the change affects TypeScript acceptance or
   inference.
2. Add a unit or render test for deterministic output and diagnostics.
3. Add E2E coverage only when a real database or catalog is needed to expose
   the regression.
4. Add only the affected dialects to the live matrix. Keep portable behavior
   in shared tests and dialect-specific behavior in focused cases.

Before opening a change, ask:

- What Qubu promise does this test protect?
- Could a type or render test prove it more directly?
- Does the test assert an outcome rather than database internals?
- Can it run independently of the other tests?
- Does the supported-dialect matrix need a new case?

## Useful commands

Run the normal checks with:

```bash
pnpm run test -- --run
pnpm run typecheck
```

Run the local SQLite E2E case with:

```bash
QUBU_E2E_DIALECT=sqlite pnpm run test:e2e
```

PostgreSQL and MySQL E2E cases require their service containers. CI starts
those containers and sets the connection environment for each matrix entry.
