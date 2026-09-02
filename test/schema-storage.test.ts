import { expect, test } from "vitest"

import {
  bigint,
  binary,
  boolean,
  date,
  integer,
  json,
  nativeColumn,
  nativeStorage,
  numeric,
  table,
  text,
  timestamp,
  uuid,
} from "../src/index.ts"

test("attaches deterministic portable storage to every built-in helper", () => {
  const definitions = {
    integer: integer(),
    numeric: numeric(),
    text: text(),
    boolean: boolean(),
    date: date(),
    timestamp: timestamp(),
    dateTime: timestamp(),
    uuid: uuid(),
    json: json(),
    bigint: bigint(),
    binary: binary(),
  }

  expect(definitions.integer.storage).toEqual({
    kind: "portable",
    type: "integer",
  })
  expect(definitions.numeric.storage).toEqual({
    kind: "portable",
    type: "numeric",
  })
  expect(definitions.text.storage).toEqual({
    kind: "portable",
    type: "text",
  })
  expect(definitions.boolean.storage).toEqual({
    kind: "portable",
    type: "boolean",
  })
  expect(definitions.date.storage).toEqual({
    kind: "portable",
    type: "date",
  })
  expect(definitions.timestamp.storage).toEqual({
    kind: "portable",
    type: "timestamp",
  })
  expect(definitions.dateTime.storage).toEqual({
    kind: "portable",
    type: "timestamp",
  })
  expect(definitions.uuid.storage).toEqual({
    kind: "portable",
    type: "uuid",
  })
  expect(definitions.json.storage).toEqual({
    kind: "portable",
    type: "json",
  })
  expect(definitions.bigint.storage).toEqual({
    kind: "portable",
    type: "bigint",
  })
  expect(definitions.binary.storage).toEqual({
    kind: "portable",
    type: "binary",
  })
  expect({
    integer: definitions.integer.sqlType,
    numeric: definitions.numeric.sqlType,
    text: definitions.text.sqlType,
    boolean: definitions.boolean.sqlType,
    date: definitions.date.sqlType,
    timestamp: definitions.timestamp.sqlType,
    uuid: definitions.uuid.sqlType,
    json: definitions.json.sqlType,
    bigint: definitions.bigint.sqlType,
    binary: definitions.binary.sqlType,
  }).toEqual({
    integer: "integer",
    numeric: "decimal",
    text: "text",
    boolean: "boolean",
    date: "date",
    timestamp: "timestamp",
    uuid: "uuid",
    json: "json",
    bigint: "bigint",
    binary: "binary",
  })
  for (const definition of Object.values(definitions)) {
    expect(Object.isFrozen(definition.storage)).toBe(true)
  }
})

test("keeps dialect and exact declaration for native storage", () => {
  const descriptor = nativeStorage("postgresql", 'citext COLLATE "C"')
  const custom = nativeColumn(descriptor, {
    nullable: true,
    sqlType: "postgres.citext",
  })
  const records = table("native_storage_records", { value: custom })

  expect(custom.storage).toEqual({
    kind: "native",
    dialect: "postgresql",
    type: 'citext COLLATE "C"',
  })
  expect(custom.storage).not.toBe(descriptor)
  expect(custom.sqlType).toBe("postgres.citext")
  expect(records.definitions.value.storage).toEqual(custom.storage)
  expect(Object.isFrozen(custom.storage)).toBe(true)
})

test("does not alter application or write metadata when storage is added", () => {
  const records = table("storage_mutations", {
    id: integer({ generated: true }),
    label: text({
      nullable: true,
      hasDefault: true,
    }),
  })

  expect(records.definitions.id.generated).toBe(true)
  expect(records.definitions.label.nullable).toBe(true)
  expect(records.definitions.label.hasDefault).toBe(true)
  expect(records.id).toBeDefined()
})
