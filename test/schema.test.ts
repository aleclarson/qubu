import { expect, expectTypeOf, test } from 'vitest'
import {
  bigint,
  binary,
  column,
  from,
  integer,
  json,
  render,
  select,
  table,
  text,
  timestamp,
  uuid,
} from '../src/index.ts'
import type { TableInsertInput, TableUpdateInput } from '../src/index.ts'

test('provides common driver-neutral schema value helpers', () => {
  const events = table('events', {
    id: uuid(),
    createdAt: timestamp(),
    sequence: bigint({ nullable: true }),
    payload: json<{ kind: string }>({ nullable: true }),
    body: binary(),
  })
  const query = select(
    {
      id: events.id,
      createdAt: events.createdAt,
      sequence: events.sequence,
      payload: events.payload,
      body: events.body,
    },
    from(events)
  )

  expect(render(query).text).toContain('FROM "events"')
  expectTypeOf(query.row.id).toBeString()
  expectTypeOf(query.row.createdAt).toEqualTypeOf<Date>()
  expectTypeOf(query.row.sequence).toEqualTypeOf<bigint | null>()
  expectTypeOf(query.row.payload).toMatchTypeOf<{ kind: string } | null>()
  const binaryValue: typeof query.row.body = new Uint8Array()
  expect(binaryValue).toBeInstanceOf(Uint8Array)
})

test('derives insert and update inputs from write-time column metadata', () => {
  const accounts = table('accounts', {
    id: integer({ generated: true }),
    email: text(),
    nickname: text({ nullable: true, hasDefault: true }),
    externalScore: column<number, string, number>({ nullable: true }),
  })

  type Insert = TableInsertInput<typeof accounts.definitions>
  type Update = TableUpdateInput<typeof accounts.definitions>

  const insert: Insert = {
    email: 'ada@example.com',
    externalScore: '10',
  }
  const update: Update = {
    email: 'grace@example.com',
    externalScore: null,
  }

  expect(insert.email).toBe('ada@example.com')
  expect(update.externalScore).toBeNull()
  // @ts-expect-error Generated identity columns are omitted from inserts.
  const missingRequired: Insert = { nickname: 'Ada' }
  // @ts-expect-error Generated identity columns are not updateable.
  const generatedUpdate: Update = { id: 2 }
  void missingRequired
  void generatedUpdate
})

test('narrows column types without changing their runtime definitions', () => {
  const statusDefinition = text()
  const narrowedStatus = statusDefinition.$type<'active' | 'disabled'>()
  const records = table('records', {
    status: narrowedStatus,
    score: column<number, string, number>().$type<1 | 2>(),
  })
  const query = select(
    { status: records.status, score: records.score },
    from(records)
  )

  type Insert = TableInsertInput<typeof records.definitions>
  type Update = TableUpdateInput<typeof records.definitions>

  expect(narrowedStatus).toBe(statusDefinition)
  expectTypeOf(query.row.status).toEqualTypeOf<'active' | 'disabled'>()
  expectTypeOf(query.row.score).toEqualTypeOf<1 | 2>()
  expectTypeOf<Insert['status']>().toEqualTypeOf<'active' | 'disabled'>()
  expectTypeOf<Insert['score']>().toEqualTypeOf<string>()
  expectTypeOf<Update['score']>().toEqualTypeOf<1 | 2 | undefined>()
  // @ts-expect-error The narrowed type excludes other strings.
  const invalidStatus: Insert['status'] = 'pending'
  // @ts-expect-error A text column cannot be narrowed to a number type.
  statusDefinition.$type<number>()
  void invalidStatus
})
