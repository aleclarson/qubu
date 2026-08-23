# Extend Qubu

> Choose an extension boundary when the built-in API does not cover a driver-specific or uncommon SQL feature.

Qubu extensions are values that render SQL and carry the metadata later
composition needs. Choose the page that matches the thing you are adding:

Ordinary query code stays on the `qubu` root entrypoint. Import fragment,
dialect, and extension constructors from `qubu/core`; import custom sources and
schema-expression constructors from `qubu/schema`. The [supported
surface](../../reference/supported-surface.md) keeps the full entrypoint map in
one place.

| You need to add...                  | Read...                                       |
| ----------------------------------- | --------------------------------------------- |
| A custom relation or clause         | [Sources and clauses](sources-and-clauses.md) |
| A dialect-specific rendering policy | [A dialect policy](dialects.md)               |
| A typed expression or SQL domain    | [Typed expressions](typed-expressions.md)     |
| Syntax Qubu does not model          | [Unsafe syntax](unsafe-syntax.md)             |

Use `context.parameter()` for runtime values. Use the typed forms when a
custom expression or source must preserve source, result, nullability, or SQL
domain metadata. The [sources and clauses](sources-and-clauses.md) page starts
with a complete custom-clause example.

## Read the concept pages

- [Source scope](../../query-model/source-scope.md) explains the identities
  custom sources must provide.
- [Fragments and metadata](../../query-model/fragments.md) explains the facts
  composition carries between fragments.
- [Dialects and execution](../../dialects-and-execution.md) explains the
  rendering and driver boundary.
- [SQL semantic types](../../sql-semantic-types.md) explains capability checks
  for typed expressions.
