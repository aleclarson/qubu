# PostgreSQL SELECT Syntax Coverage

This document tracks which parts of the PostgreSQL `SELECT` syntax the qubu query builder currently supports and where the gaps are.

## Confirmed Coverage

| Area               | Details                                                                             | Evidence                                                   |
| ------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Select list        | `select()` builds field metadata for column refs, expressions, and aliased objects. | `src/blocks/select.ts:54`<br>`test/select.test.ts:25`      |
| Table wildcard     | `table['*']` delegates to `Table.$all()` and is rendered in queries.                | `src/definition/table.ts:90`<br>`test/select.test.ts:15`   |
| Table aliasing     | `Table.as()` returns an identifier with mapped columns consumed by `select()`.      | `src/definition/table.ts:56`<br>`test/select.test.ts:35`   |
| Column aliasing    | `SQL.Expression.as()` is enforced in the select clause and verified in tests.       | `src/core/sql.ts:116`<br>`test/select.test.ts:56`          |
| Distinct variants  | `selectDistinct`, `distinct()` and `distinctOn()` emit the correct modifiers.       | `src/blocks/select.ts:131`<br>`test/select.test.ts:66`     |
| FROM clause basics | `from()` accepts one or many table references and renders comma joins.              | `src/blocks/select.ts:201`<br>`test/select.test.ts:46`     |
| Scalar subqueries  | `select()` accepts `SQL.QueryIdentifier` outputs for nested queries.                | `src/blocks/select.ts:77`<br>`test/subqueries.test.ts:7`   |
| Aggregation helper | `count()` covers `COUNT(*)` and `COUNT(expr)` usage.                                | `src/blocks/select.ts:261`<br>`test/subqueries.test.ts:10` |
| WHERE predicates   | `where()` pairs with `SQL.Expression.is()` for comparisons.                         | `src/blocks/select.ts:243`<br>`test/subqueries.test.ts:10` |

## Partial / Untested Support

| Area                | Gaps                                                                                                                                                         | Evidence                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Join helpers        | `innerJoin`, `leftJoin`, `fullJoin`, `crossJoin`, and `naturalJoin` exist but have no coverage; `cross/natural` still require `.on()`, which is invalid SQL. | `src/blocks/select.ts:210`                            |
| ORDER BY            | `orderBy()` and the `.asc()/.desc()` modifiers generate tokens, but no tests confirm rendering or NULLS options.                                             | `src/blocks/select.ts:249`<br>`src/core/sql.ts:168`   |
| Derived tables      | Queries can be aliased via `.as()` for reuse in `FROM`, yet tests are skipped.                                                                               | `src/core/sql.ts:392`<br>`test/subqueries.test.ts:28` |
| IN/NOT IN operators | Supported through `SQL.Expression.is('in', …)` but untested outside snapshots.                                                                               | `src/core/sql.ts:126`<br>`src/binaryOperator.ts:2`    |

## Missing Syntax (Prioritized)

| Priority | Feature                                                                           | Notes                                                                                                                               |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Critical | `GROUP BY`, `GROUPING SETS`, `ROLLUP`, `CUBE`                                     | No helper or component under `src/blocks` to build grouping clauses; required for most aggregate queries.                           |
| Critical | `HAVING` clause                                                                   | No support for post-aggregation filters; depends on `GROUP BY` support.                                                             |
| Critical | `LIMIT`, `OFFSET`, `FETCH`                                                        | Builder lacks any limiting/fetch API, forcing consumers to fall back to raw SQL.                                                    |
| High     | `WITH` / `WITH RECURSIVE` (CTEs) and `MATERIALIZED` options                       | No facilities to prefix queries with CTEs or mark materialization preferences.                                                      |
| High     | Set operations (`UNION`, `INTERSECT`, `EXCEPT` with `ALL/DISTINCT`)               | No composition helpers to combine multiple `SELECT` statements.                                                                     |
| High     | `WINDOW` clause definitions                                                       | Missing support for naming window definitions separate from the select list.                                                        |
| High     | Join coverage gaps                                                                | No `RIGHT JOIN`, no `JOIN … USING`, no `LATERAL` joins, and `CROSS/NATURAL` require `.on()`.                                        |
| Medium   | Locking (`FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `SKIP LOCKED`, `NOWAIT`) | No component to request row-level locks.                                                                                            |
| Medium   | `SELECT … INTO`                                                                   | No API for the table-creating variant of `SELECT`.                                                                                  |
| Medium   | Table sampling and inheritance controls                                           | `TABLESAMPLE`, `WITH ORDINALITY`, and `ONLY` are not represented.                                                                   |
| Low      | Misc query decorations                                                            | Features like result `OFFSET` framing with `ROWS ONLY` keywords or `TABLE` queries remain unaddressed until higher priorities land. |
