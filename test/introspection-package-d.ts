import { expectTypeOf } from 'vitest'
import * as root from 'qubu'
import * as introspection from 'qubu/introspection'
import * as snapshot from 'qubu/snapshot'
import type {
  CatalogConnection,
  CatalogIntrospector,
  IntrospectionOptions,
  IntrospectionResult,
} from 'qubu/introspection'
import type { SchemaSnapshot } from 'qubu/snapshot'

expectTypeOf(introspection.readPostgresCatalog).toBeFunction()
expectTypeOf(introspection.readSqliteCatalog).toBeFunction()
expectTypeOf(introspection.readMysqlCatalog).toBeFunction()
expectTypeOf(introspection.mapCatalogToSnapshot).toBeFunction()
expectTypeOf<CatalogConnection>().toMatchTypeOf<object>()
expectTypeOf<CatalogIntrospector>().toMatchTypeOf<
  (
    connection: CatalogConnection,
    options: IntrospectionOptions
  ) => Promise<IntrospectionResult>
>()
expectTypeOf<SchemaSnapshot>().toMatchTypeOf<object>()
expectTypeOf(snapshot.createSchemaSnapshot).toBeFunction()

// @ts-expect-error Introspection is intentionally not re-exported from qubu.
root.readPostgresCatalog
