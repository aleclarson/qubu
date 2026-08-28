# Fragments and metadata

> Build custom SQL from values while preserving the source, result, grouping, and capability facts that later composition checks.

## A fragment has a renderer and metadata

The runtime unit is a `Fragment`:

```ts
Fragment<Metadata>
```

The renderer appends SQL and parameters to a context. The metadata type records
facts that the next composition step needs. The main groups are:

| Fact                                                    | What it records                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ResultMeta<Output, NullableFrom, SqlType>`             | The value or row produced, sources that can make it `null`, and its SQL domain.                       |
| `CardinalityMeta<QueryCardinality>`                     | Whether a query returns `many`, `zero-or-one`, or `exactly-one` rows.                                 |
| `RequiresSourceMeta` and `ProvidesSourceMeta`           | Which source a fragment needs and which source a `FROM` or join introduces.                           |
| `RequiresOuterSourceMeta` and `ProvidesOuterSourceMeta` | Which enclosing source a correlated or LATERAL query reads and how `correlate()` provides it.         |
| `NullableSourceMeta`                                    | Which source became nullable through an outer join.                                                   |
| `ExpressionMeta`, `AggregateMeta`, and `GroupingMeta`   | The columns an expression reads, consumes inside an aggregate, or makes available through `GROUP BY`. |

An untyped extension uses `SqlUnknown` for its SQL domain. Declare a domain when
the extension needs incompatible operations to fail at the call site. See
[SQL semantic types](../sql-semantic-types.md).

## Preserve metadata when composing fragments

Composition helpers keep the facts that their children already carry:

| Composition                                                     | Result                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `sequence()`, `commaSeparated()`, `keyword()`, `parenthesize()` | Preserve inherited source and nullability facts without inventing a result or query cardinality. |
| An expression wrapper such as `expressionFragment()`            | Preserve the wrapped result, source, nullability, and SQL domain.                                |
| A source-aware operator such as `upper(column)`                 | Create a new result while inheriting the operand's source and nullability facts.                 |
| An aggregate such as `count(column)`                            | Mark argument dependencies as aggregate-consumed, so they do not need to appear in `GROUP BY`.   |
| `groupBy()`                                                     | Record grouping expressions and the column dependencies they make available.                     |
| `leftJoin()`                                                    | Add `NullableSourceMeta` for the joined source.                                                  |

The type-level contract stays small. `OutputOf<T>` describes a result,
`SqlTypeOf<T>` its SQL domain, `RequiresOf<T>` its required sources, and
`NullabilityOf<T>` the sources that can make it null after an outer join.

Qubu does not infer every SQL rule. Grouping checks use declared dependencies,
and functional dependencies from database keys are handled where the source
model explicitly proves them. New metadata belongs in this union only when a
producer, consumer, and regression test all exist.

## Parameters are runtime data

Parameter values are not fragment metadata. A renderer calls
`context.parameter(value)`, and `render()` collects values in placeholder order:

```ts
import { and, eq, from, integer, like, render, select, table, text, where } from "qubu"

const users = table("users", {
  id: integer(),
  name: text(),
})

const query = select(
  { id: users.id },
  from(users),
  where(and(eq(users.id, 7), like(users.name, "%Ada%"))),
)

render(query)
// text:       ... WHERE (("users"."id" = ?) AND ("users"."name" LIKE ?))
// parameters: [7, '%Ada%']
```

The parameter array follows the placeholders in the rendered text. `select()`
normalizes independent clause values, but keep the final call in SQL order in
new code so source scope and repair hints are visible at a glance.

The public [`sql` template tag](../guides/sql-templates.md) uses the same
renderer. Ordinary substitutions call `context.parameter()`, while expression,
query, and fragment substitutions call back into the active render context.
The tag therefore keeps placeholder numbering, dialect behavior, and inherited
metadata in one composition path.

## Keep the boundary explicit

Qubu tracks source scope, result shape, nullability, cardinality, and portable
SQL capabilities. It does not encode every vendor grammar rule or implicit
conversion. Use standard fragments for portable SQL and move vendor-specific
syntax to [dialects or custom extensions](../dialects-and-execution.md).

## Read next

- [Source scope](source-scope.md) covers source identities and correlation.
- [Result shapes and cardinality](result-shapes.md) covers projections and
  nullable results.
- [Extend Qubu](../guides/extensions/overview.md) applies this model to custom
  expressions, clauses, and sources.
