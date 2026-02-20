# qubu MVP Roadmap

This document outlines the path to a 1.0.0 (MVP) release for `qubu`. The goal is to provide a stable, type-safe, and functional-first SQL query builder for PostgreSQL.

## 1. Core Statement Support
Implement the full lifecycle of the four primary SQL statements.

- [x] **SELECT**
  - [x] `select(columns, ...)`
  - [x] `from(tables)`
  - [x] `distinct()`, `distinctOn(columns)`
  - [x] Column & Table aliasing (`.as()`)
  - [ ] `limit(n)`, `offset(n)`
  - [ ] `groupBy(columns)`, `having(conditions)`
- [ ] **INSERT**
  - [x] `insertInto(table)`
  - [x] `values(data)`
  - [ ] `returning(columns)`
  - [ ] `onConflict(...)` (Full implementation)
- [ ] **UPDATE**
  - [ ] `update(table)`
  - [ ] `set(data)`
  - [ ] `where(conditions)`
  - [ ] `returning(columns)`
- [ ] **DELETE**
  - [ ] `deleteFrom(table)`
  - [ ] `where(conditions)`
  - [ ] `returning(columns)`

## 2. Clauses & Operators
Enhance the expressiveness of queries while maintaining type safety.

- [ ] **Joins**
  - [x] `innerJoin`, `leftJoin`, `fullJoin`, `crossJoin`
  - [ ] Type-safe join conditions (ensure columns belong to joined tables)
- [ ] **Conditions (WHERE/HAVING)**
  - [x] `is(left, op, right)` (Functional approach)
  - [ ] Logical operators: `and()`, `or()`, `not()`
  - [ ] Null checks: `isNull()`, `isNotNull()`
  - [ ] Pattern matching: `like()`, `ilike()`
  - [ ] Range/Set: `between()`, `in()`
- [ ] **Ordering**
  - [x] `orderBy(columns)`
  - [x] `.asc()`, `.desc()`
  - [x] `nullsFirst()`, `nullsLast()`
- [ ] **CTEs & Subqueries**
  - [x] Basic CTE support in `QueryClient`
  - [ ] Better API for defining and using CTEs
  - [x] `exists(query)`, `notExists(query)`

## 3. PostgreSQL Specifics
Embrace the dialect as per the [Vision](VISION.md).

- [ ] **JSONB Support**
  - [ ] Operators: `->`, `->>`, `#>`, `#>>`
  - [ ] Containment: `@>`, `<@`, `?`, `?|`, `?&`
- [ ] **Array Support**
  - [x] `arrayLiteral`
  - [ ] Array operators: `&&`, `@>`, `<@`
- [ ] **Casting**
  - [x] `.cast(type)`

## 4. Type Safety & Inference
The "Zero Magic" promise backed by TypeScript.

- [x] Infer SELECT results from column definitions.
- [ ] Infer RETURNING results for INSERT/UPDATE/DELETE.
- [ ] Strict typing for table/column references in clauses.
- [ ] Support for Standard Schema (`$type(schema)`) in column definitions.

## 5. Client & Adapters
Ensuring `qubu` can actually run queries.

- [x] Generic `QueryClient`
- [x] Bun Native Adapter
- [ ] `pg` (Node-Postgres) Adapter
- [ ] Transaction Support (`client.transaction(async tx => ... )`)
- [ ] Connection Pooling integration

## 6. Documentation & Testing
- [ ] **API Reference:** Comprehensive JSDoc for all exported functions.
- [ ] **Examples:** A dedicated `examples/` directory with common patterns.
- [ ] **Testing:**
  - [ ] 100% coverage for core SQL generation.
  - [ ] Integration tests against a real PostgreSQL instance (via Docker/Testcontainers).
  - [ ] Performance benchmarks for query building.
