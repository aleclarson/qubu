import { expect, test } from "vitest"

import { doNothing, onConflict, postgresDialect } from "../src/dialects/postgres.ts"
import {
  bigint,
  boolean,
  booleanResultDecoder,
  caseWhen,
  eq,
  executeRows,
  from,
  insertInto,
  insertSelect,
  integer,
  QueryValidationError,
  render,
  returning,
  select,
  table,
  text,
  unique,
  value,
  values,
  type QueryAdapter,
} from "../src/index.ts"

const records = table("audit_records", {
  id: integer(),
  label: text(),
})

test("renders INSERT conflict handling before RETURNING regardless of argument order", () => {
  const query = insertInto(
    records,
    values({
      id: 1,
      label: "Ada",
    }),
    returning({ id: records.id }),
    onConflict(doNothing()),
  )

  expect(render(query, postgresDialect())).toEqual({
    text: 'INSERT INTO "audit_records" ("id", "label") VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING "audit_records"."id" AS "id"',
    parameters: [1, "Ada"],
    parameterSqlTypes: ["integer", "text"],
  })
})

test("rejects duplicate INSERT RETURNING clauses before choosing a result shape", () => {
  expect(() =>
    insertInto(
      records,
      values({
        id: 1,
        label: "Ada",
      }),
      returning({ id: records.id }),
      returning({ label: records.label }),
    ),
  ).toThrowError(QueryValidationError)
})

test("rejects duplicate PostgreSQL INSERT conflict clauses", () => {
  expect(() =>
    render(
      insertInto(
        records,
        values({
          id: 1,
          label: "Ada",
        }),
        onConflict(doNothing()),
        onConflict(doNothing()),
      ),
      postgresDialect(),
    ),
  ).toThrowError(QueryValidationError)
})

test("rejects INSERT SELECT projection and target counts that differ", () => {
  const destination = table("audit_destination", { label: text() })
  const source = select({
    label: value("Ada"),
    extra: value(7),
  })

  expect(() => render(insertInto(destination, insertSelect(source, ["label"])))).toThrowError(
    QueryValidationError,
  )
})

test("accepts INSERT SELECT projections matching the target count", () => {
  const destination = table("audit_destination", { label: text() })

  expect(
    render(insertInto(destination, insertSelect(select({ label: value("Ada") }), ["label"]))),
  ).toEqual({
    text: 'INSERT INTO "audit_destination" ("label") SELECT ? AS "label"',
    parameters: ["Ada"],
  })
})

test("rejects a conflict target belonging to a different INSERT table", () => {
  const other = table("audit_other", { label: text() }, (columns) => ({
    constraints: { labelKey: unique(columns.label) },
    indexes: {},
  }))

  // Otherwise a valid key on another table silently chooses this table's conflict column.
  expect(() =>
    render(
      insertInto(
        records,
        values({
          id: 1,
          label: "Ada",
        }),
        onConflict(other, other.constraints.labelKey, doNothing()),
      ),
      postgresDialect(),
    ),
  ).toThrowError(QueryValidationError)
})

test("decodes CASE boolean branches through the adapter's boolean policy", async () => {
  const flags = table("audit_flags", { enabled: boolean() })
  const adapter: QueryAdapter = {
    dialect: postgresDialect(),
    decoders: { boolean: booleanResultDecoder },
    async execute() {
      return { rows: [{ enabled: 1 }] }
    },
  }
  const query = select(
    { enabled: caseWhen(eq(flags.enabled, true), flags.enabled, flags.enabled) },
    from(flags),
  )

  await expect(executeRows(query, adapter)).resolves.toEqual([{ enabled: true }])
})

test("decodes CASE bigint branches without losing their exact integer representation", async () => {
  const counters = table("audit_counters", { sequence: bigint() })
  const adapter: QueryAdapter = {
    dialect: postgresDialect(),
    async execute() {
      return { rows: [{ sequence: "9007199254740993" }] }
    },
  }
  const query = select(
    { sequence: caseWhen(eq(counters.sequence, 0n), counters.sequence, counters.sequence) },
    from(counters),
  )

  await expect(executeRows(query, adapter)).resolves.toEqual([{ sequence: 9007199254740993n }])
})

test("decodes direct boolean and bigint projections with the same adapter policies", async () => {
  const typed = table("audit_typed", {
    enabled: boolean(),
    sequence: bigint(),
  })
  const adapter: QueryAdapter = {
    dialect: postgresDialect(),
    decoders: { boolean: booleanResultDecoder },
    async execute() {
      return {
        rows: [
          {
            enabled: 1,
            sequence: "9007199254740993",
          },
        ],
      }
    },
  }

  await expect(
    executeRows(
      select(
        {
          enabled: typed.enabled,
          sequence: typed.sequence,
        },
        from(typed),
      ),
      adapter,
    ),
  ).resolves.toEqual([
    {
      enabled: true,
      sequence: 9007199254740993n,
    },
  ])
})
