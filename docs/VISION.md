# qubu Vision & Mental Model

`qubu` is a functional-first, type-safe SQL query builder for TypeScript. It aims to bridge the gap between raw SQL strings and heavy ORMs.

## 1. The Core Philosophy (The "Why")

- **SQL Mirroring:** If you know SQL, you should know `qubu`. The API structure should mirror SQL syntax.
- **Functional-First:** Standalone functions are the default. Chaining is an exception, used only when type safety requires it (e.g., `insert(into(…).values(…))`) or for hierarchical context (e.g., `onConflict(…).doNothing()`).
- **Zero Magic:** No hidden behavior, automatic joins, or implicit mappings. Everything must be explicitly traceable.
- **Type Safety Above All:** Valid SQL should be representable; invalid SQL should be caught by the TypeScript compiler whenever possible.

## 2. The Mental Model (The "How")

### The SQL Component Builder
Think of `qubu` as building blocks for SQL.
1.  **Definitions**: Tables/columns are schemas.
2.  **Composition**: Functions (`select`, `from`, `where`) return `SQL` fragments.
3.  **Tokenization**: A `Query` stores a sequence of tokens and parameters.
4.  **Stringification**: `SQL.toString()` converts the `Query` into a parameterized SQL string and values.

**Key Abstraction:** *Everything is a fragment.* Whether it's a clause (`where`), a value (`1`), or a whole statement, they are all composable SQL parts.

## 3. The Feature Filter (The "Decision Framework")

Before adding a feature, ask:
1.  **Is it SQL?** Does it map directly to a SQL keyword or clause?
2.  **The User-Land Test:** Can a user achieve this with `sql` or `unsafe` fragments? If so, why does it need to be in core?
3.  **The Commonality Test:** Does this solve a problem for 80% of users, or is it a niche 20% case?
4.  **The Maintenance Cost:** Does this introduce new internal abstractions or complex type-level logic?

## 4. Explicit Non-Goals
- **Object-Relational Mapping (ORM):** No relationship management or lazy loading.
- **Schema Migrations:** Use a dedicated tool for migrations.
- **Dialect Erasure:** `qubu` embraces specific database syntax (starting with PostgreSQL) rather than hiding it.
