# Qubu vision and mental model

> Internal product direction for a functional, type-aware SQL builder whose core stays small while dialect and adapter differences remain explicit.

## Core philosophy

- **SQL fidelity:** Generated SQL should be predictable to a developer who
  already knows SQL.
- **Functional composition:** Tables, expressions, clauses, subqueries, and
  complete queries are values composed by small functions.
- **Small primitives:** The core should expose fragments, identifiers,
  parameters, sequences, and dialects rather than a mutable all-purpose query
  singleton.
- **Useful type information:** A fragment carries the semantic facts downstream
  composition needs: output shape, source requirements, and parameter types.
- **Explicit extension:** Standard SQL belongs in the core. Dialect differences
  and uncommon syntax belong in separate modules or custom primitives.
- **Safe defaults:** Values are parameters and identifiers are quoted. Raw
  syntax requires an explicit escape hatch.

## Mental model

Everything that can be composed is a fragment:

```ts
Fragment<Output, RequiredSources, Parameters>
```

The renderer stays small while metadata accumulates through composition. A
`FROM` clause contributes sources, a projection determines the row shape, and
expressions retain the sources and parameter types they require.

The core layers are:

1. definitions for tables and columns;
2. fragments and rendering primitives;
3. expressions and operators;
4. independent SQL clauses;
5. queries that assemble a projection and clauses; and
6. dialect policies that render the final syntax.

## Extension filter

Before adding a core feature, ask:

1. Is it standard SQL or a documented dialect capability?
2. Can users express it with existing fragments or `customClause`?
3. Does it preserve source requirements, output shape, parameterization, and
   rendering order?
4. Is a small value clearer than a new stateful builder abstraction?

Extensions should depend on public primitives and should not require a global
operator registry or privileged central query object.

## Explicit non-goals

- ORM relationship management, lazy loading, change tracking, or identity maps.
- Schema migrations and database lifecycle management.
- Hidden execution, connection ownership, or transaction orchestration.
- Hiding meaningful dialect differences behind a lowest-common-denominator API.
