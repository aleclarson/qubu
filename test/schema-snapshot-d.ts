import { expectTypeOf } from "vitest"

import { createDialect } from "../src/core/index.ts"
import { schema, table, text } from "../src/index.ts"
import { createSchemaDialect } from "../src/schema/index.ts"
import type {
  SchemaSnapshot,
  SchemaSnapshotAdapter,
  SnapshotDialectExtension,
  SnapshotStorage,
} from "../src/snapshot/index.ts"
import { createSchemaSnapshot, encodeSchemaSnapshot } from "../src/snapshot/index.ts"

const records = table("records", { name: text() })
const model = createSchemaSnapshot(schema({ records }))

expectTypeOf(model).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(model.tables[0]?.columns[0]?.storage).toMatchTypeOf<SnapshotStorage | undefined>()
expectTypeOf(encodeSchemaSnapshot(model)).toBeString()

const adapterDialect = createSchemaDialect(
  createDialect({
    name: "custom-sql",
    placeholder: () => "?",
  }),
  {
    version: 1,
    encodeStorage(storage): SnapshotStorage {
      return storage.kind === "portable"
        ? {
            kind: "native",
            dialect: "custom-sql",
            type: storage.type,
          }
        : storage
    },
    encodeDialectExtension(extension): SnapshotDialectExtension {
      return {
        dialect: "custom-sql",
        version: 1,
        data: { source: extension.dialect },
      }
    },
  },
)
const adapter: SchemaSnapshotAdapter = { dialect: adapterDialect }

expectTypeOf(adapter.dialect.name).toBeString()
