import { expectTypeOf } from "vitest"

import { identityColumn, integer, schema, table } from "../src/index.ts"
import {
  createSchemaSnapshot,
  type SchemaSnapshot,
  type SchemaSnapshotAdapter,
  type SnapshotStorage,
} from "../src/snapshot/index.ts"
import {
  createSqliteSchemaSnapshot,
  sqliteSnapshotAdapter,
  sqliteStorageAffinity,
} from "../src/snapshot/sqlite.ts"

const records = table("records", {
  id: integer({
    identity: identityColumn("by-default", {
      dialect: {
        dialect: "sqlite",
        autoIncrement: true,
      },
    }),
  }),
})
const registry = schema({ records })

expectTypeOf(createSqliteSchemaSnapshot(registry)).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(
  createSchemaSnapshot(registry, { adapter: sqliteSnapshotAdapter }),
).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(sqliteSnapshotAdapter).toMatchTypeOf<SchemaSnapshotAdapter>()
expectTypeOf(sqliteStorageAffinity("INTEGER")).toEqualTypeOf<
  "integer" | "text" | "numeric" | "blob" | "real"
>()
expectTypeOf<SnapshotStorage>().toMatchTypeOf<{
  readonly kind: string
}>()
