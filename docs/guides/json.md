# Query nested JSON

> Build inferred nested results, or read scalar values from stored JSON documents.

Use jsonArrayFrom() to nest a query's rows and jsonObjectFrom() for a query
proven to return at most one row. Both preserve filtering, correlation,
ordering, and pagination:

```ts
import {
  correlate,
  desc,
  eq,
  fetchFirst,
  from,
  integer,
  jsonArrayFrom,
  jsonObjectFrom,
  orderBy,
  select,
  table,
  text,
  where,
} from "qubu"

const users = table("users", { id: integer(), name: text() })
const posts = table("posts", {
  id: integer(),
  authorId: integer(),
  title: text(),
})
const latestPosts = select(
  { id: posts.id, title: posts.title },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id)),
  orderBy(desc(posts.id)),
  fetchFirst(3),
)
const latestPost = select(
  { title: posts.title },
  from(posts),
  correlate(users),
  where(eq(posts.authorId, users.id)),
  orderBy(desc(posts.id)),
  fetchFirst(1),
)
const query = select(
  {
    name: users.name,
    posts: jsonArrayFrom(latestPosts),
    latestPost: jsonObjectFrom(latestPost),
  },
  from(users),
)
// Row: { name: string; posts: { id: number; title: string }[];
//        latestPost: { title: string } | null }
```

Execute the query through a Qubu adapter to decode nested results. An empty
array query returns []; an empty object query returns null. A source-free
query proven to return exactly one row produces a non-null object type.
Object queries need Qubu's cardinality proof: an unconditional fetchFirst(1)
or fetchFirst(0) establishes the bound. A conditional limit does not.

The helpers compose inside further select() projections, so nesting can
continue without result-type assertions. correlate() and the outer query's
FROM/JOIN scope remain checked at every level.

### Preserve ordering and logical values

Nested arrays retain explicit ORDER BY and pagination. Tied sort keys retain
SQL's unspecified tie order; add a unique tie-breaker when order matters.
DISTINCT ordering must use the same expressions as the selection. Without an
ORDER BY, array order is unspecified.

Nested results support PostgreSQL, MySQL 8.0.21+, and SQLite 3.45+. Other
dialects fail during rendering. SQLite's minimum includes the JSON aggregate
ordering fix needed to retain object values.

Built-in column domains decode to their declared types, including bigint,
Uint8Array, Date, boolean, and nested JSON. Qubu transports precision-sensitive
values as text and rejects numbers that lose significant decimal digits or
exceed JavaScript's safe integer range. Use bigint columns for exact large
integers. Unknown or custom SQL domains need a supported explicit cast, for
example cast(value(7), integer()); declaring a TypeScript result alone does
not provide runtime decoding information.

Custom mapResult() and column decoders receive the JSON transport value as
unknown: bigint and decimal strings, hexadecimal binary strings, serialized
JSON strings, or ordinary JSON scalar values. They own conversion to their
advertised application type. Adapter-wide decoders do not run inside nested
objects. Keep arbitrary stored JSON within JavaScript's numeric precision;
unsupported numeric representations fail instead of silently rounding.

## Read stored JSON scalars

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
