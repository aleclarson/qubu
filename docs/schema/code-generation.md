# Generate a schema from introspection

> Generate a TypeScript schema module from a complete introspection result with no omitted facts.

Source generation is an optional capability exported from `qubu/codegen`. It
is a pure handoff after introspection: it opens no connection, runs no catalog
query, and writes no file. The caller owns those boundaries.

## Generate a module

Read and map one namespace in strict mode, then pass that exact result to the
generator:

```ts
import { writeFile } from "node:fs/promises"
import { generateSchemaSource } from "qubu/codegen"
import { mapCatalogToSnapshot } from "qubu/introspection"
import { readCatalog } from "qubu/introspection/sqlite"

const catalog = await readCatalog(connection, { namespace: "main" })
const introspection = mapCatalogToSnapshot(catalog, { namespace: "main" })
const generated = generateSchemaSource(introspection)

if (!generated.ok) {
  throw new Error(generated.diagnostics.map((issue) => issue.message).join("\n"))
}

await writeFile("src/schema.generated.ts", generated.source, "utf8")
```

`writeFile()` belongs to the application; `generateSchemaSource()` only
returns data. A successful result contains deterministic `source` and every
retained diagnostic. A failed result contains diagnostics and no partial
source.

### What the module contains

The module exports each ordinary Snapshot v1 table and one schema registry. It
reconstructs:

- Physical names and exact native storage.
- Column write behavior and defaults.
- Generated-column and identity metadata.
- Constraints and indexes.
- Opaque predicates and expressions.
- Dialect extensions.

Checks use `catalogCheck()`. Foreign keys use lazy `catalogForeignKey()` targets
so forward declarations and cycles remain valid.

## Adopt the generated identity baseline

The first introspection snapshot commonly uses physical names as logical IDs.
Generated declarations use deterministic camelCase registry, table, column,
constraint, and index IDs while retaining every physical database name. Once
the generated module is accepted, its serialized snapshot becomes the identity
baseline for the next catalog read:

```ts
import { mapCatalogToSnapshot } from "qubu/introspection"
import { createSchemaSnapshot } from "qubu/snapshot/sqlite"
import { mainSchema } from "./schema.generated.ts"

const previousSnapshot = createSchemaSnapshot(mainSchema)
const next = mapCatalogToSnapshot(nextCatalog, {
  namespace: "main",
  previousSnapshot,
})
```

This handoff is deliberate. Do not keep using the pre-generation snapshot as
the long-term identity source, or later diffs will compare physical IDs with
the new generated IDs.

## Control names and column types

Application output, insert, and update types default independently to
`unknown`. Qubu may attach a SQL semantic domain only when catalog evidence is
exact. Native storage always keeps the catalog declaration, even when the
semantic domain remains `SqlUnknown`.

Use the controlled callbacks to adopt trusted names or application mappings:

```ts
const generated = generateSchemaSource(introspection, {
  naming(context) {
    if (context.kind === "table" && context.physicalName === "user_records") {
      return "users"
    }
  },
  mapColumn(context) {
    if (context.columnPhysicalName === "account_id") {
      return {
        output: "string",
        insert: "string",
        update: "string",
        sqlDomain: "uuid",
      }
    }
  },
})
```

Callbacks select names and fixed type tokens; they never take over printing and
cannot return imports, expressions, comments, or arbitrary source. A returned
name must still be a safe camelCase ID. Collisions and unsafe names fail with
diagnostics and no source.

## Diagnostics and source safety

Generation fails when the input contains:

- Failed or lossy introspection.
- An edited snapshot that no longer matches its catalog.
- Omitted Snapshot v1 facts or unresolved references.
- Unsafe names or invalid mapping tokens.
- Data that cannot be printed safely as source.

Existing introspection diagnostics stay attached to the result.

> [!IMPORTANT]
> A database can allow a foreign key to reference a nullable `UNIQUE`
> constraint. Snapshot v1 retains that constraint as nullable uniqueness, not
> as a Qubu candidate key. Source generation returns an
> `unrepresentable-fact` diagnostic instead of weakening the generated
> `references()` proof. Use a non-null primary key, strict unique key, or
> candidate index as the foreign-key target before adopting generated source.

Catalog names, native declarations, SQL, and extension metadata are untrusted
input. The printer serializes them only as controlled literals beneath a
static header. It does not interpolate catalog text as code or comments, parse
opaque SQL, or merge a previous generated file with hand edits. Treat the file
as replaceable output and keep application customizations in separate modules.

The public types and TSDoc on `generateSchemaSource()`,
`SchemaCodegenOptions`, and `CodegenDiagnostic` define the exact callback and
result contracts.

## Snapshot v1 boundary

Generation covers ordinary Snapshot v1 tables in one namespace. It does not emit:

- Views and materialized views.
- Sequences, enums, and domains.
- Routines and triggers.
- Partitions and policies.
- Collations and extensions.
- Comments and ownership.
- Retained opaque or deferred objects.

If any excluded family is non-empty, generation reports diagnostics rather than
presenting the module as complete.

The caller handles file writes and driver integration. Generation does not
merge hand edits or run migrations.

Use
[Database introspection](introspection.md) for the catalog boundary and
[Canonical schema snapshots](snapshots.md) for the identity artifact.
