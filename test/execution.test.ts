import { expect, expectTypeOf, test } from "vitest"

import { postgresDialect } from "../src/dialects/postgres.ts"
import { standardDialect } from "../src/dialects/standard.ts"
import {
  alias,
  bigint,
  boolean,
  booleanResultDecoder,
  column,
  cte,
  date,
  dateResultDecoder,
  eq,
  execute,
  executeRows,
  from,
  insertInto,
  integer,
  json,
  jsonTextResultDecoder,
  mapResult,
  numeric,
  qubu,
  returning,
  select,
  table,
  timestamp,
  timestampResultDecoder,
  values,
  value,
  where,
  withCte,
  uuid,
  type ExecutionRequest,
  type QueryAdapter,
  ResultDecodingError,
  type TransactionOptions,
  type TransactionalQueryAdapter,
} from "../src/index.ts"

const users = table("users", { id: integer() })

test("passes the rendered query kind and abort signal to the adapter", async () => {
  let received: ExecutionRequest | undefined
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      received = request
      return {
        rows: [{ id: 7 }] as unknown as readonly TRow[],
      }
    },
  }
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))
  const controller = new AbortController()

  const result = await execute(query, adapter, {
    dialect: postgresDialect(),
    signal: controller.signal,
  })

  expect(received).toEqual({
    statement: {
      text: 'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = $1)',
      parameters: [7],
    },
    queryKind: "select",
    resultShape: { fields: [{ name: "id", sqlType: "integer" }] },
    signal: controller.signal,
  })
  expect(result).toEqual({ rows: [{ id: 7 }] })
  expectTypeOf(result.rows).toEqualTypeOf<readonly { id: number }[]>()
})

test("preserves bigint results without converting through Number", async () => {
  const records = table("records", { sequence: bigint() })
  const query = select({ sequence: records.sequence }, from(records))
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute(request) {
      expect(request.resultShape).toEqual({
        fields: [{ name: "sequence", type: "bigint", sqlType: "bigint" }],
      })
      return { rows: [{ sequence: "9007199254740993" }] }
    },
  }

  await expect(executeRows(query, adapter)).resolves.toEqual([{ sequence: 9007199254740993n }])
})

test("exposes portable SQL domains in result shapes", () => {
  const records = table("records", {
    eventDate: date(),
    createdAt: timestamp(),
    identifier: uuid(),
    amount: numeric(),
    sequence: bigint(),
  })
  const query = select(
    {
      eventDate: records.eventDate,
      createdAt: records.createdAt,
      identifier: records.identifier,
      amount: records.amount,
      sequence: records.sequence,
    },
    from(records),
  )

  expect(query.resultShape).toEqual({
    fields: [
      { name: "eventDate", type: "date", sqlType: "date" },
      { name: "createdAt", type: "timestamp", sqlType: "timestamp" },
      { name: "identifier", sqlType: "uuid" },
      { name: "amount", sqlType: "decimal" },
      { name: "sequence", type: "bigint", sqlType: "bigint" },
    ],
  })
})

test("decodes portable schema values through aliases with adapter policies", async () => {
  const events = table("events", {
    active: boolean(),
    eventDate: date(),
    createdAt: timestamp(),
    payload: json<{ kind: string }>(),
  })
  const event = alias(events, "event")
  const projected = select(
    {
      enabled: event.active,
      occurredOn: event.eventDate,
      recordedAt: event.createdAt,
      metadata: event.payload,
      matches: eq(event.active, true),
    },
    from(event),
  )
  const derived = alias(projected, "derived_event")
  const derivedQuery = select(
    {
      isEnabled: derived.enabled,
      dateAlias: derived.occurredOn,
      timestampAlias: derived.recordedAt,
      jsonAlias: derived.metadata,
      expressionAlias: derived.matches,
    },
    from(derived),
  )
  const decodedEvents = cte("decoded_events", derivedQuery)
  const query = select(
    {
      isEnabled: decodedEvents.isEnabled,
      dateAlias: decodedEvents.dateAlias,
      timestampAlias: decodedEvents.timestampAlias,
      jsonAlias: decodedEvents.jsonAlias,
      expressionAlias: decodedEvents.expressionAlias,
    },
    withCte(decodedEvents),
    from(decodedEvents),
  )
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    decoders: {
      boolean: booleanResultDecoder,
      date: dateResultDecoder,
      timestamp: timestampResultDecoder,
      json: jsonTextResultDecoder,
    },
    async execute() {
      return {
        rows: [
          {
            isEnabled: 1,
            dateAlias: "2026-08-27",
            timestampAlias: "2026-08-27 14:30:00",
            jsonAlias: '{"kind":"created"}',
            expressionAlias: 0,
          },
        ],
      }
    },
  }

  await expect(executeRows(query, adapter)).resolves.toEqual([
    {
      isEnabled: true,
      dateAlias: new Date("2026-08-27T00:00:00.000Z"),
      timestampAlias: new Date("2026-08-27T14:30:00.000Z"),
      jsonAlias: { kind: "created" },
      expressionAlias: false,
    },
  ])
})

test("leaves result domains unchanged without an adapter decoder", async () => {
  const documents = table("documents", { payload: json<string>() })
  const query = select({ payload: documents.payload }, from(documents))
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [{ payload: '"already a JSON string"' }] }
    },
  }

  await expect(executeRows(query, adapter)).resolves.toEqual([
    { payload: '"already a JSON string"' },
  ])
})

test("uses a column decoder without requiring an adapter policy", async () => {
  const metrics = table("metrics", {
    score: column<number>({ decode: (value) => Number(value) }),
  })
  const query = select({ decodedScore: metrics.score }, from(metrics))
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [{ decodedScore: "42" }] }
    },
  }

  await expect(executeRows(query, adapter)).resolves.toEqual([{ decodedScore: 42 }])
})

test("maps custom expression results without changing their SQL", async () => {
  const query = select({ score: mapResult(value("42"), Number) })
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute() {
      return { rows: [{ score: "42" }] }
    },
  }

  const rows = await executeRows(query, adapter)

  expect(rows).toEqual([{ score: 42 }])
  expectTypeOf(rows).toEqualTypeOf<readonly { score: number }[]>()
})

test("reports result decoding failures without exposing the raw value", async () => {
  const flags = table("flags", { active: boolean() })
  const query = select({ secretFlag: flags.active }, from(flags))
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    decoders: { boolean: booleanResultDecoder },
    async execute() {
      return { rows: [{ secretFlag: "sensitive-invalid-value" }] }
    },
  }

  const error = await executeRows(query, adapter).catch((value) => value)

  expect(error).toBeInstanceOf(ResultDecodingError)
  expect(error).toMatchObject({
    field: "secretFlag",
    rowIndex: 0,
    resultType: "boolean",
  })
  expect(String(error)).not.toContain("sensitive-invalid-value")
  expect(error).not.toHaveProperty("cause")
})

test("returns mutation facts and unwraps rows on request", async () => {
  const requests: ExecutionRequest[] = []
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      requests.push(request)
      return {
        rows: [{ id: 8 }] as unknown as readonly TRow[],
        affectedRows: 1n,
        changedRows: 1,
        insertId: "8",
      }
    },
  }
  const query = insertInto(users, values({ id: 8 }), returning({ id: users.id }))

  const result = await execute(query, adapter)
  const rows = await executeRows(adapter, query)

  expect(result).toEqual({
    rows: [{ id: 8 }],
    affectedRows: 1n,
    changedRows: 1,
    insertId: "8",
  })
  expect(rows).toEqual([{ id: 8 }])
  expect(requests.map((request) => request.queryKind)).toEqual(["insert", "insert"])
  expectTypeOf(rows).toEqualTypeOf<readonly { id: number }[]>()
})

test("decodes mutation RETURNING projections", async () => {
  const flags = table("flags", { active: boolean() })
  const query = insertInto(flags, values({ active: true }), returning({ enabled: flags.active }))
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    decoders: { boolean: booleanResultDecoder },
    async execute() {
      return { rows: [{ enabled: 0 }] }
    },
  }

  await expect(executeRows(query, adapter)).resolves.toEqual([{ enabled: false }])
})

test("binds one adapter for structured and row-only execution", async () => {
  const requests: ExecutionRequest[] = []
  const adapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      requests.push(request)
      return {
        rows: [{ id: 7 }] as unknown as readonly TRow[],
        affectedRows: 1,
      }
    },
  }
  const db = qubu(adapter)
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))

  const result = await db.execute(query, { dialect: postgresDialect() })
  const rows = await db.rows(query)

  expect(db.adapter).toBe(adapter)
  expect(result).toEqual({
    rows: [{ id: 7 }],
    affectedRows: 1,
  })
  expect(rows).toEqual([{ id: 7 }])
  expect(requests.map((request) => request.statement.text)).toEqual([
    'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = $1)',
    'SELECT "users"."id" AS "id" FROM "users" WHERE ("users"."id" = ?)',
  ])
})

test("binds a transaction-scoped client to the adapter transaction", async () => {
  const events: string[] = []
  const controller = new AbortController()
  const query = select({ id: users.id }, from(users), where(eq(users.id, 7)))
  const transactionAdapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(request: ExecutionRequest) {
      events.push(`execute:${request.queryKind}`)
      return { rows: [{ id: 7 }] as unknown as readonly TRow[] }
    },
  }
  const adapter: TransactionalQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(): Promise<{ rows: readonly TRow[] }> {
      throw new Error("The root adapter should not execute inside this test.")
    },
    async transaction<T>(
      callback: (adapter: QueryAdapter) => Promise<T>,
      options?: TransactionOptions,
    ) {
      expect(options?.signal).toBe(controller.signal)
      events.push("begin")
      const result = await callback(transactionAdapter)

      events.push("commit")
      return result
    },
  }

  const result = await qubu(adapter).transaction(
    async (transaction) => {
      expect(transaction.adapter).toBe(transactionAdapter)
      expect("transaction" in transaction).toBe(false)
      await expect(transaction.rows(query)).resolves.toEqual([{ id: 7 }])
      return "committed"
    },
    { signal: controller.signal },
  )

  expect(result).toBe("committed")
  expect(events).toEqual(["begin", "execute:select", "commit"])
})

test("preserves a rejected transaction callback through the adapter", async () => {
  const events: string[] = []
  const failure = new Error("transaction callback failed")
  const transactionAdapter: QueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>() {
      return { rows: [] as readonly TRow[] }
    },
  }
  const adapter: TransactionalQueryAdapter = {
    dialect: standardDialect(),
    async execute<TRow extends object>(): Promise<{ rows: readonly TRow[] }> {
      throw new Error("The root adapter should not execute inside this test.")
    },
    async transaction<T>(callback: (adapter: QueryAdapter) => Promise<T>) {
      events.push("begin")
      try {
        const result = await callback(transactionAdapter)

        events.push("commit")
        return result
      } catch (error) {
        events.push("rollback")
        throw error
      } finally {
        events.push("release")
      }
    },
  }

  await expect(
    qubu(adapter).transaction(async () => {
      throw failure
    }),
  ).rejects.toBe(failure)
  expect(events).toEqual(["begin", "rollback", "release"])
})
