# Read JSON scalars

> Extract a string, number, or boolean from a JSON column without writing a raw SQL path.

Use a structured jsonPath() when a query needs a scalar or an existence check
inside a JSON document:

```ts
import {
  from,
  json,
  jsonBoolean,
  jsonExists,
  jsonNumber,
  jsonPath,
  jsonText,
  select,
  table,
} from "qubu"

const events = table("events", {
  payload: json<{
    user?: { name?: string; active?: boolean; score?: number }
  }>(),
})

const query = select(
  {
    name: jsonText(events.payload, jsonPath("user", "name")),
    active: jsonBoolean(events.payload, jsonPath("user", "active")),
    score: jsonNumber(events.payload, jsonPath("user", "score")),
    hasUser: jsonExists(events.payload, jsonPath("user")),
  },
  from(events),
)
```

Strings are object keys. Non-negative integers are array indexes. Qubu keeps the
path structured so a dialect can encode each key and index without
interpolating caller-provided SQL.

## Understand missing values

Scalar reads return SQL NULL when the path is missing, contains JSON null, or
resolves to another JSON scalar type. jsonExists() returns true for a present
JSON null, false for a missing path, and false when the document itself is SQL
NULL.

These rules keep path existence separate from extraction nullability.

## Check dialect support

The standard dialect emits SQL/JSON JSON_VALUE and JSON_EXISTS syntax.
PostgreSQL, MySQL, and SQLite use their native JSON policies. The current
policies require PostgreSQL 12 or newer, MySQL 8.0.21 or newer, and SQLite JSON
functions. An application-created dialect must provide a JSON renderer.

## Know the current limits

JSON paths cover deterministic key and index traversal. Wildcards, filters,
recursive descent, JSON-returning extraction, document mutation, and row
expansion remain dialect-specific extensions.

For the SQL domain and nullability rules behind JSON columns, read
[SQL semantic types](../sql-semantic-types.md).
