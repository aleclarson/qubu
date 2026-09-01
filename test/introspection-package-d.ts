import * as root from "qubu"
import * as introspection from "qubu/introspection"
import type {
  CatalogConnection,
  CatalogIntrospector,
  IntrospectionOptions,
  IntrospectionResult,
} from "qubu/introspection"
import * as mysqlIntrospection from "qubu/introspection/mysql"
import * as postgresIntrospection from "qubu/introspection/postgres"
import * as sqliteIntrospection from "qubu/introspection/sqlite"
import * as snapshot from "qubu/snapshot"
import type { SchemaSnapshot } from "qubu/snapshot"
import * as mysqlSnapshot from "qubu/snapshot/mysql"
import * as postgresSnapshot from "qubu/snapshot/postgres"
import * as sqliteSnapshot from "qubu/snapshot/sqlite"
import { expectTypeOf } from "vitest"

expectTypeOf(introspection.mapCatalogToSnapshot).toBeFunction()
expectTypeOf(postgresIntrospection.readCatalog).toBeFunction()
expectTypeOf(sqliteIntrospection.readCatalog).toBeFunction()
expectTypeOf(mysqlIntrospection.readCatalog).toBeFunction()
expectTypeOf<CatalogConnection>().toMatchTypeOf<object>()
expectTypeOf<CatalogIntrospector>().toMatchTypeOf<
  (connection: CatalogConnection, options: IntrospectionOptions) => Promise<IntrospectionResult>
>()
expectTypeOf<SchemaSnapshot>().toMatchTypeOf<object>()
expectTypeOf(snapshot.createSchemaSnapshot).toBeFunction()
expectTypeOf(postgresSnapshot.createSchemaSnapshot).toBeFunction()
expectTypeOf(sqliteSnapshot.createSchemaSnapshot).toBeFunction()
expectTypeOf(mysqlSnapshot.createSchemaSnapshot).toBeFunction()

// @ts-expect-error Dialect-specific snapshot creators have dedicated entrypoints.
snapshot.createPostgresSchemaSnapshot

// @ts-expect-error The PostgreSQL subpath uses the shared creator name.
postgresSnapshot.createPostgresSchemaSnapshot

// @ts-expect-error Dialect-specific introspection readers have dedicated entrypoints.
introspection.readPostgresCatalog

// @ts-expect-error Introspection is intentionally not re-exported from qubu.
root.readCatalog
