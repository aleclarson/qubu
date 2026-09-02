# Canonical schema snapshots

> Serialize schema metadata into strict, deterministic data and keep serialization separate from diffing, planning, and DDL emission.

Qubu's schema tooling lives behind the `qubu/snapshot` entrypoint. It converts
an immutable `schema()` registry into versioned data that can be inspected,
hashed, checked into source control, and handed to a dialect adapter. Importing
the snapshot entrypoint is optional; ordinary query imports do not load it.

```ts
import { createSchemaSnapshot, encodeSchemaSnapshot } from "qubu/snapshot"

const snapshot = createSchemaSnapshot(appSchema)
const json = encodeSchemaSnapshot(snapshot)
```

The Snapshot v1 envelope contains a format version, an independently versioned
dialect extension, a versioned naming-policy description, a namespace,
capability facts, and arrays for every supported object family. Tables,
columns, constraints, and indexes are sorted by stable logical ID. Physical
names are values in the snapshot, not identities:
changing a physical name does not change the TypeScript field or metadata key.

Snapshot data is deliberately not executable Qubu state. Expressions are
parameter-free data records, and decoding never creates tables, column
references, or render closures. The neutral fallback renders branded built-in
expressions through the standard schema context; a dialect adapter may replace
that hook with its own literal and expression policy. An explicitly unsafe
expression retains its dialect tag and is rejected when it does not match the
selected snapshot dialect.

```ts
import { decodeSchemaSnapshot } from "qubu/snapshot"

const decoded = decodeSchemaSnapshot(json)
if (!decoded.ok) {
  for (const issue of decoded.diagnostics) {
    console.error(issue.path.join("."), issue.code, issue.message)
  }
}
```

The decoder is strict. It reports unknown fields, malformed nodes, unsupported
future format or extension versions, non-canonical entity ordering, wrong
dialect metadata, and broken foreign-key or column references as structured
diagnostics. It does not call `process.exit()` and has no runtime validation
library dependency.

References to nested columns, constraints, and indexes carry an explicit
`owner: { kind, id }` scope. Table columns, constraints, and indexes are owned
by their table; view columns are owned by their view; and domain constraints
are owned by their domain. References to top-level objects remain ownerless,
and the decoder validates each nested scope independently. Dialect metadata is
checked only in typed snapshot fields. Extension `data`, `configuration`, and
other opaque JSON payloads are retained as data and are not interpreted as
typed metadata.

`schemaSnapshotFingerprint()` computes a deterministic content fingerprint from canonical
JSON. The fingerprint is useful for cache keys and fixture assertions only. It is not
an entity identity, a rename marker, or migration lineage.

## Adapter boundary

`SchemaDialect` is a capability superset of `Dialect`. Create one with
`createSchemaDialect(queryDialect, hooks)`; the resulting object retains the
query dialect's name, identifier quoting, placeholders, literals, JSON, casts,
and advertised capabilities while adding schema encoders and validation under
`.schema`. Snapshot adapters reference that object instead of constructing a
second query dialect. The schema snapshot format version remains independent
from the dialect identity.

The common traversal owns logical IDs, fixed property order, canonical sorting,
portable constraints, cross-reference checks, and the immutable snapshot
envelope. A dialect adapter owns physical storage mapping, SQL literal and
expression encoding, dialect extensions, capability checks, and any dialect
naming policy. PostgreSQL, SQLite, and MySQL adapters can implement
`SchemaSnapshotAdapter` without duplicating traversal or decoder rules.
The neutral API stays at `qubu/snapshot`; built-in dialect adapters have
dedicated subpaths so importing neutral snapshot utilities does not widen that
API:

```ts
import { createSchemaSnapshot } from "qubu/snapshot"
import { createSchemaSnapshot as createPostgresSnapshot } from "qubu/snapshot/postgres"

const neutral = createSchemaSnapshot(appSchema)
const postgres = createPostgresSnapshot(appSchema)
```

The PostgreSQL adapter is documented in the [PostgreSQL snapshot support
matrix](../reference/postgres-snapshot.md). Its schema dialect extends the
`postgresql` query dialect, and snapshot metadata uses that same identity.
The SQLite adapter is documented in the [SQLite snapshot support
matrix](../reference/sqlite-snapshot.md).
The MySQL adapter is documented in the [MySQL snapshot support
matrix](../reference/mysql-snapshot.md). Its query and snapshot dialects both
use `mysql`, while MySQL-only `ON UPDATE` and `AUTO_INCREMENT` details remain
inside the column and identity metadata they describe.

Snapshot serialization remains separate from database introspection,
comparison, rename resolution, migration planning, and DDL emission. The
optional `qubu/introspection` entrypoint can produce the same canonical
Snapshot v1 data from a user-owned catalog connection. The complete normalized
catalog can also be encoded with the explicit complete-snapshot APIs described
in [the catalog model](catalog-model.md).
Readers and connection lifecycle do not belong to this pure serialization
layer. Diffing consumes Snapshot v1. Resolved diffs feed
migration plans, and approved plans feed DDL emission. The package-wide
[ownership map](../reference/supported-surface.md#ownership-boundary) keeps
those pure steps separate from application-owned database execution.

The optional [schema source generator](code-generation.md) consumes a complete,
non-lossy introspection result and makes its generated schema the next identity
baseline. It does not replace snapshot serialization or populate non-table
object families.
