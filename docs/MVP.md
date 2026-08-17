# qubu SELECT MVP

The first coherent release is a fully composable, standard-SQL `SELECT` builder. Mutations and driver execution are deliberately outside this milestone so the fragment and type model can settle around one complete statement family.

## 1. Core Rendering

- [x] Render SQL text and ordered bound parameters.
- [x] Escape identifiers through a dialect.
- [x] Render standard `?` placeholders.
- [x] Provide an explicit unsafe syntax escape hatch.
- [x] Keep fragments small and independently composable.

## 2. Definitions and Type Inference

- [x] Declare tables and typed columns once.
- [x] Track nullable column output types.
- [x] Expose table and derived-source column references.
- [x] Infer object and list projection row types.
- [x] Track source requirements through expressions and clauses.
- [x] Track parameter types through composed fragments.

## 3. SELECT Statements

- [x] Object, list, column, and wildcard projections.
- [x] `DISTINCT`.
- [x] `FROM` with multiple sources.
- [x] `INNER`, `LEFT`, `RIGHT`, `FULL`, `CROSS`, and `NATURAL` joins.
- [x] `WHERE`.
- [x] `GROUP BY` and `HAVING`.
- [x] `ORDER BY`, direction, and null ordering.
- [x] Standard `OFFSET` and `FETCH FIRST/NEXT` pagination.
- [x] Common table expressions.
- [x] Derived-table and scalar subqueries.
- [x] `EXISTS`, `IN`, and comparison predicates.
- [x] `UNION`, `UNION ALL`, `INTERSECT`, and `EXCEPT`.

## 4. Expressions

- [x] Values and explicit parameters.
- [x] Equality and relational comparisons.
- [x] `IS NULL`, `LIKE`, `IN`, `BETWEEN`, and distinctness predicates.
- [x] `AND`, `OR`, and `NOT`.
- [x] Arithmetic operators.
- [x] Standard function-call and aggregate primitives.
- [x] Aliases, casts, and simple `CASE` expressions.

## 5. Dialects and Extension Points

- [x] Standard SQL dialect.
- [x] PostgreSQL placeholder dialect as an optional adapter module.
- [x] Public custom fragments.
- [x] Public custom clauses with explicit placement and ordering.
- [ ] Dialect-specific expression and pagination modules.
- [ ] Adapter contracts for execution and driver value encoding.

## 6. Deliberately Deferred

- [ ] `INSERT`, `UPDATE`, and `DELETE`.
- [ ] Transactions, connection pooling, and driver adapters.
- [ ] Schema introspection and migrations.
- [ ] Full window-function and vendor-specific syntax coverage.
- [ ] Runtime row decoding beyond user-supplied column types.

The completion criterion is not the number of helpers. It is that the standard `SELECT` model remains understandable, type propagation survives nested composition, and dialect extensions do not require changes to a central builder object.
