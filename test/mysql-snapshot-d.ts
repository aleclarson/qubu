import { expectTypeOf } from "vitest"

import {
  identityColumn,
  integer,
  schema,
  table,
  timestamp,
  type ColumnOnUpdateOf,
  type MysqlIdentityExtension,
} from "../src/index.ts"
import { defineSchemaExpression } from "../src/schema/index.ts"
import {
  createSchemaSnapshot,
  type SchemaSnapshot,
  type SchemaSnapshotAdapter,
  type SnapshotStorage,
} from "../src/snapshot/index.ts"
import {
  createSchemaSnapshot as createMysqlSchemaSnapshot,
  mysqlSnapshotAdapter,
} from "../src/snapshot/mysql.ts"

const currentTimestamp = defineSchemaExpression("function", (context) => {
  context.append("CURRENT_TIMESTAMP")
})
const records = table("records", {
  id: integer({
    identity: identityColumn("by-default", {
      dialect: {
        dialect: "mysql",
        autoIncrement: true,
      },
    }),
  }),
  updatedAt: timestamp({ onUpdate: currentTimestamp }),
})
const registry = schema({ records })

expectTypeOf(createMysqlSchemaSnapshot(registry)).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(
  createSchemaSnapshot(registry, { adapter: mysqlSnapshotAdapter }),
).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(mysqlSnapshotAdapter).toMatchTypeOf<SchemaSnapshotAdapter>()
expectTypeOf<MysqlIdentityExtension>().toMatchTypeOf<{
  readonly dialect: "mysql"
  readonly autoIncrement?: boolean
}>()
expectTypeOf<ColumnOnUpdateOf<typeof records.definitions.updatedAt>>().toMatchTypeOf<
  typeof currentTimestamp | undefined
>()
expectTypeOf<SnapshotStorage>().toMatchTypeOf<{ readonly kind: string }>()
