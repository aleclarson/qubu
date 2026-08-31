import * as root from "qubu"
import * as introspection from "qubu/introspection"
import type {
  CatalogConnection,
  CatalogIntrospector,
  IntrospectionOptions,
  IntrospectionResult,
} from "qubu/introspection"
import * as snapshot from "qubu/snapshot"
import type { SchemaSnapshot } from "qubu/snapshot"
import * as mysqlSnapshot from "qubu/snapshot/mysql"
import * as postgresSnapshot from "qubu/snapshot/postgres"
import * as sqliteSnapshot from "qubu/snapshot/sqlite"
import { expectTypeOf } from "vitest"

expectTypeOf(introspection.readPostgresCatalog).toBeFunction()
expectTypeOf(introspection.readSqliteCatalog).toBeFunction()
expectTypeOf(introspection.readMysqlCatalog).toBeFunction()
expectTypeOf(introspection.mapCatalogToSnapshot).toBeFunction()
expectTypeOf<CatalogConnection>().toMatchTypeOf<object>()
expectTypeOf<CatalogIntrospector>().toMatchTypeOf<
  (connection: CatalogConnection, options: IntrospectionOptions) => Promise<IntrospectionResult>
>()
expectTypeOf<SchemaSnapshot>().toMatchTypeOf<object>()
expectTypeOf(snapshot.createSchemaSnapshot).toBeFunction()
expectTypeOf(postgresSnapshot.createPostgresSchemaSnapshot).toBeFunction()
expectTypeOf(sqliteSnapshot.createSqliteSchemaSnapshot).toBeFunction()
expectTypeOf(mysqlSnapshot.createMysqlSchemaSnapshot).toBeFunction()

// @ts-expect-error Dialect-specific snapshot creators have dedicated entrypoints.
snapshot.createPostgresSchemaSnapshot

// @ts-expect-error Introspection is intentionally not re-exported from qubu.
root.readPostgresCatalog
