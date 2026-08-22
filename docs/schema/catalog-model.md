# Complete catalog model

Qubu keeps database discovery in a normalized catalog before producing a
snapshot. The catalog is a read-only record of observed facts; it does not
contain a connection, execute catalog SQL, or assign database catalog keys as
persisted logical IDs.

The optional `qubu/introspection` entry point exposes the complete object
families and an immutable materializer:

```ts
import {
  createCompleteIntrospectionCatalog,
  mapCatalogToCompleteSnapshot,
} from 'qubu/introspection'

const completeCatalog = createCompleteIntrospectionCatalog(catalog)
const result = mapCatalogToCompleteSnapshot(completeCatalog)
```

Tables, columns, views, materialized views, sequences, enums, domains,
collations, triggers, routines, partitions, row-level policies, extension
objects, comments, and ownership metadata have typed records. A reader may
also retain a deferred or opaque object when it observes a family that Qubu
cannot yet normalize. Such an object remains visible and can carry opaque
catalog data, SQL text, provenance, and a dialect extension; it is never
silently dropped.

Physical names and references describe the current database. Stable logical
IDs are evidence selected by the adapter's identity policy. PostgreSQL OIDs,
SQLite implementation names, and similar catalog keys stay in current-run
references and are not used as logical IDs.

## Snapshot v2

`qubu/snapshot` provides the strict complete format as a separate API:

```ts
import {
  decodeCompleteSchemaSnapshot,
  encodeCompleteSchemaSnapshot,
} from 'qubu/snapshot'

const encoded = encodeCompleteSchemaSnapshot(snapshotV2)
const decoded = decodeCompleteSchemaSnapshot(encoded)
```

Snapshot v2 uses the same `qubu-schema` envelope with `version: 2`. Its
namespace, capability facts, object-family arrays, cross-object references,
provenance, typed dialect extensions, and deferred/opaque boundaries are
strictly validated. Arrays are ordered by logical ID (with ordinal sequences
and index terms ordered by their semantic position), and the digest is computed
from the deterministic encoding.

Snapshot v1 remains a separate strict format. `decodeSchemaSnapshot` still
accepts only v1 and continues to reject unknown fields and future versions;
v2 callers must select `decodeCompleteSchemaSnapshot` explicitly. Neither
snapshot format evaluates database-provided SQL.
