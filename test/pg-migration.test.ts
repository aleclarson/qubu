import type { ClientBase } from "pg"
import { encodeSchemaSnapshot, type SchemaSnapshot } from "qubu/snapshot"
import { expect, test, vi } from "vitest"

import { pgMigrationAdapter, readPgMigrationSnapshot } from "../adapters/pg/src/migration.ts"
import {
  postgresColumnsQuery,
  postgresConstraintsQuery,
  postgresIndexesQuery,
  postgresMetadataQuery,
  postgresRelationsQuery,
  postgresServerQuery,
} from "../src/introspection/postgres.ts"

type Row = Record<string, unknown>

function fixture() {
  const tables = ["accounts", "external", "__qubu_migration_checkpoints"]
  const rows: Record<string, Row[]> = {
    [postgresServerQuery]: [
      {
        server_version_num: "170000",
        server_version: "17.0",
      },
    ],
    [postgresRelationsQuery]: tables.map((name, i) => ({
      oid: String(i + 1),
      namespace: "public",
      relname: name,
      relkind: "r",
      relispartition: false,
    })),
    [postgresColumnsQuery]: tables.map((_, i) => ({
      table_oid: String(i + 1),
      ordinal_position: 1,
      physical_name: "id",
      nullable: false,
      native_type: "integer",
      attidentity: "",
      attgenerated: "",
      default_expression: null,
    })),
    [postgresConstraintsQuery]: [
      {
        oid: "10",
        table_oid: "1",
        physical_name: "accounts_pkey",
        contype: "p",
        conkey: [1],
        convalidated: true,
        backing_index_oid: "11",
      },
    ],
    [postgresIndexesQuery]: [
      {
        index_oid: "11",
        table_oid: "1",
        physical_name: "accounts_pkey",
        indisunique: true,
        indnkeyatts: 1,
        indnatts: 1,
        method: "btree",
        position: 1,
        attnum: 1,
        indoption: 0,
      },
    ],
    [postgresMetadataQuery]: [
      ...tables.flatMap((name, i) => [
        {
          catalog_relation: "pg_class",
          object_oid: String(i + 1),
          object_subid: 0,
          object_kind: "table",
          object_name: name,
          owner: "app",
          description: "table comment",
        },
        {
          catalog_relation: "pg_class",
          object_oid: String(i + 1),
          object_subid: 1,
          object_kind: "column",
          object_name: "id",
          owner: "app",
          description: "column comment",
        },
      ]),
      {
        catalog_relation: "pg_constraint",
        object_oid: "10",
        object_subid: 0,
        object_kind: "constraint",
        object_name: "accounts_pkey",
        owner: "app",
      },
      {
        catalog_relation: "pg_class",
        object_oid: "11",
        object_subid: 0,
        object_kind: "index",
        object_name: "accounts_pkey",
        owner: "app",
      },
    ],
  }
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => ({
    rows: rows[sql] ?? [],
    rowCount: 0,
  }))

  return {
    rows,
    query,
    client: { query } as unknown as ClientBase,
  }
}

test("captures managed pg facts while excluding journal and unmanaged table metadata", async () => {
  const { client, query } = fixture()
  const all = await readPgMigrationSnapshot(client)
  const table = all.snapshot.tables[0]!
  const scope: SchemaSnapshot = {
    ...all.snapshot,
    tables: [
      {
        ...table,
        columns: [
          ...table.columns,
          {
            ...table.columns[0]!,
            id: "missing",
            physicalName: "missing",
            ordinalPosition: 2,
          },
        ],
      },
    ],
  }
  const result = await readPgMigrationSnapshot(client, scope)

  expect(result.snapshot.tables.map((table) => table.physicalName)).toEqual(["accounts"])
  expect(result.snapshot.tables[0]!.columns.map((column) => column.physicalName)).toEqual(["id"])
  expect(result.unmanagedObjects).toEqual([
    {
      kind: "table",
      physicalName: "external",
    },
  ])
  expect(encodeSchemaSnapshot(result.snapshot)).not.toContain("__qubu_migration_")
  expect(
    result.snapshot.comments.every(
      (item) => item.object.id !== "external" && item.object.owner?.id !== "external",
    ),
  ).toBe(true)
  expect(
    query.mock.calls
      .filter(([sql]) => sql !== postgresServerQuery)
      .every(([, parameters]) => parameters?.[0] === "public"),
  ).toBe(true)
})

test("preserves metadata identities for same-named constraints, indexes, and table columns", async () => {
  const { client } = fixture()
  const first = await readPgMigrationSnapshot(client)
  const previous: SchemaSnapshot = {
    ...first.snapshot,
    comments: first.snapshot.comments.map((item, i) => ({
      ...item,
      id: `comment${i}`,
    })),
    ownership: first.snapshot.ownership.map((item, i) => ({
      ...item,
      id: `ownership${i}`,
    })),
  }
  const reread = await readPgMigrationSnapshot(client, previous)

  expect(reread.snapshot.comments).toEqual(previous.comments)
  expect(reread.snapshot.ownership).toEqual(previous.ownership)
  expect(
    reread.snapshot.ownership
      .filter((item) => item.physicalName === "accounts_pkey")
      .map((item) => item.object.kind)
      .sort(),
  ).toEqual(["constraint", "index"])
  expect(
    reread.snapshot.comments
      .filter((item) => item.physicalName === "id")
      .map((item) => item.object.owner?.id)
      .sort(),
  ).toEqual(["accounts", "external"])
  expect(
    encodeSchemaSnapshot((await readPgMigrationSnapshot(client, reread.snapshot)).snapshot),
  ).toBe(encodeSchemaSnapshot(reread.snapshot))
})

test("preserves table and column logical IDs without supplying absent managed tables", async () => {
  const { client } = fixture()
  const first = await readPgMigrationSnapshot(client)
  const accounts = first.snapshot.tables[0]!
  // Select identities without prior metadata so all returned metadata must follow the new graph.
  const scope: SchemaSnapshot = {
    ...first.snapshot,
    comments: [],
    ownership: [],
    tables: [
      {
        ...accounts,
        id: "customers",
        columns: [
          {
            ...accounts.columns[0]!,
            id: "identifier",
          },
        ],
      },
      {
        ...accounts,
        id: "missing",
        physicalName: "missing",
      },
    ],
  }
  const result = await readPgMigrationSnapshot(client, scope)

  expect(result.snapshot.tables.map((table) => table.id)).toEqual(["customers"])
  expect(result.snapshot.tables[0]!.columns[0]!.id).toBe("identifier")
  expect(result.snapshot.comments.find((item) => item.physicalName === "id")?.object).toEqual({
    kind: "column",
    id: "identifier",
    owner: {
      kind: "table",
      id: "customers",
    },
  })
})

test("rejects strict pg catalog failures and unresolved managed relationships", async () => {
  const failed = fixture()

  failed.query.mockRejectedValueOnce(new Error("catalog denied"))
  await expect(readPgMigrationSnapshot(failed.client)).rejects.toThrow(
    "Strict PostgreSQL introspection failed",
  )

  const foreignKey = fixture()

  foreignKey.rows[postgresConstraintsQuery]!.push({
    oid: "20",
    table_oid: "1",
    physical_name: "external_fk",
    contype: "f",
    conkey: [1],
    target_table_oid: "2",
    confkey: [1],
    convalidated: true,
  })
  const all = await readPgMigrationSnapshot(foreignKey.client)

  await expect(
    readPgMigrationSnapshot(foreignKey.client, {
      ...all.snapshot,
      tables: [all.snapshot.tables[0]!],
    }),
  ).rejects.toThrow("Strict PostgreSQL introspection failed")
})

test("uses caller inspection overrides and leaves pinned pg client shutdown to its owner", async () => {
  const { client, query } = fixture()
  const end = vi.fn()

  Object.assign(client, { end })
  const inspection = await readPgMigrationSnapshot(client)
  const readSnapshot = vi.fn(async () => inspection)
  const session = await pgMigrationAdapter(client, { readSnapshot }).openMigrationSession()

  expect(await session.readSnapshot!(inspection.snapshot)).toBe(inspection)
  expect(readSnapshot).toHaveBeenCalledWith(client, inspection.snapshot)
  await session.close()
  expect(end).not.toHaveBeenCalled()
  expect(query).toHaveBeenCalled()
})
