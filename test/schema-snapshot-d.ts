import { expectTypeOf } from 'vitest'
import type {
  SchemaSnapshot,
  SchemaSnapshotAdapter,
  SnapshotDialectExtension,
  SnapshotStorage,
} from '../src/snapshot/index.ts'
import {
  createSchemaSnapshot,
  encodeSchemaSnapshot,
} from '../src/snapshot/index.ts'
import { schema, table, text } from '../src/index.ts'

const records = table('records', { name: text() })
const model = createSchemaSnapshot(schema({ records }))

expectTypeOf(model).toMatchTypeOf<SchemaSnapshot>()
expectTypeOf(model.tables[0]?.columns[0]?.storage).toMatchTypeOf<
  SnapshotStorage | undefined
>()
expectTypeOf(encodeSchemaSnapshot(model)).toBeString()

const adapter: SchemaSnapshotAdapter = {
  dialect: { name: 'postgres', version: 1 },
  encodeStorage(storage): SnapshotStorage {
    return storage.kind === 'portable'
      ? { kind: 'native', dialect: 'postgres', type: storage.type }
      : storage
  },
  encodeDialectExtension(extension): SnapshotDialectExtension {
    return {
      dialect: 'postgres',
      version: 1,
      data: { source: extension.dialect },
    }
  },
}

expectTypeOf(adapter.dialect.name).toBeString()
