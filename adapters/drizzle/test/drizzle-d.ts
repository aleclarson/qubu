import { toMysqlDrizzleSchema, type MysqlDrizzleSchema } from "@qubu/drizzle/mysql"
import {
  toPostgresDrizzleSchema,
  type PostgresDrizzleSchema,
  type PostgresDrizzleTable,
} from "@qubu/drizzle/postgres"
import { sqliteTimestamp, toSqliteDrizzleSchema } from "@qubu/drizzle/sqlite"
import type { MySqlTable } from "drizzle-orm/mysql-core"
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres"
import type { PgTable } from "drizzle-orm/pg-core"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { column, integer, nativeColumn, portableStorage, schema, table, text } from "qubu"
import { expectTypeOf } from "vitest"

type UserName = string & { readonly __brand: "UserName" }

const users = table("user_records", {
  id: integer({ generated: true }),
  name: text().$type<UserName>(),
  nickname: text({ nullable: true }),
  role: text({ default: "member" }),
})
const appSchema = schema({ users })
const postgres = toPostgresDrizzleSchema(appSchema)
const mysql = toMysqlDrizzleSchema(appSchema)
const sqlite = toSqliteDrizzleSchema(appSchema)

type UserRow = {
  id: number
  name: UserName
  nickname: string | null
  role: string
}
type UserInsert = {
  name: UserName
  nickname: string | null
  role?: string
}

expectTypeOf(postgres.users).toExtend<PgTable>()
expectTypeOf(mysql.users).toExtend<MySqlTable>()
expectTypeOf(sqlite.users).toExtend<SQLiteTable>()
expectTypeOf<typeof postgres.users.$inferSelect>().toEqualTypeOf<UserRow>()
expectTypeOf<typeof postgres.users.$inferInsert>().toEqualTypeOf<UserInsert>()
expectTypeOf<typeof mysql.users.$inferSelect>().toEqualTypeOf<UserRow>()
expectTypeOf<typeof mysql.users.$inferInsert>().toEqualTypeOf<UserInsert>()
expectTypeOf<typeof sqlite.users.$inferSelect>().toEqualTypeOf<UserRow>()
expectTypeOf<typeof sqlite.users.$inferInsert>().toEqualTypeOf<UserInsert>()
expectTypeOf(postgres).toEqualTypeOf<PostgresDrizzleSchema<typeof appSchema>>()
expectTypeOf(postgres.users).toEqualTypeOf<PostgresDrizzleTable<typeof users>>()
expectTypeOf(mysql).toEqualTypeOf<MysqlDrizzleSchema<typeof appSchema>>()

const timestampRecords = table("timestamp_records", {
  createdAt: sqliteTimestamp({ defaultFn: () => new Date() }),
  updatedAt: sqliteTimestamp({ mode: "timestamp_ms" }),
})
const sqliteTimestamps = toSqliteDrizzleSchema(schema({ timestampRecords }))

expectTypeOf<typeof sqliteTimestamps.timestampRecords.$inferSelect>().toEqualTypeOf<{
  createdAt: Date
  updatedAt: Date
}>()
expectTypeOf<typeof sqliteTimestamps.timestampRecords.$inferInsert>().toEqualTypeOf<{
  createdAt?: Date
  updatedAt: Date
}>()

const db = pgDrizzle.mock()

db.insert(postgres.users).values({
  name: "Ada" as UserName,
  nickname: null,
})

db.update(postgres.users).set({
  nickname: null,
  role: "admin",
})
db.update(postgres.users).set({
  // @ts-expect-error id is generated and cannot be updated.
  id: 1,
})
db.update(postgres.users).set({
  // @ts-expect-error $type() narrowing is retained by Drizzle writes.
  name: "Ada",
})

// Nullable Qubu columns remain required when they have no default.
// @ts-expect-error nickname is required on insert.
db.insert(postgres.users).values({ name: "Ada" as UserName })

// Generated Qubu columns stay unavailable to ordinary Drizzle inserts.
db.insert(postgres.users).values({
  // @ts-expect-error id is generated.
  id: 1,
  name: "Ada" as UserName,
  nickname: null,
})

const divergent = schema({
  values: table("divergent_values", {
    value: column<number, string, number>({
      storage: portableStorage("integer"),
    }),
  }),
})

// Drizzle has one application value type per column.
// @ts-expect-error divergent select, insert, and update types are not lossless.
toPostgresDrizzleSchema(divergent)

const missingStorage = schema({
  values: table("missing_storage", { value: column<number>() }),
})

// @ts-expect-error every converted column needs physical storage.
toPostgresDrizzleSchema(missingStorage)

const mysqlNative = schema({
  values: table("mysql_native", {
    value: nativeColumn("mysql", "VARCHAR(191)"),
  }),
})

// @ts-expect-error native storage must belong to the selected dialect.
toPostgresDrizzleSchema(mysqlNative)
toMysqlDrizzleSchema(mysqlNative)
