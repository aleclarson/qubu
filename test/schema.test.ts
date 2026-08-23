import { expect, expectTypeOf, test } from 'vitest'
import {
  alias,
  asc,
  bigint,
  binary,
  column,
  check,
  eq,
  foreignKey,
  from,
  integer,
  index,
  json,
  lower,
  primaryKey,
  render,
  schema,
  references,
  select,
  table,
  text,
  timestamp,
  uuid,
  unique,
  value,
} from '../src/index.ts'
import {
  generatedTableName,
  schemaNamingPolicyVersion,
  SchemaValidationError,
} from '../src/schema/registry.ts'
import type { TableInsertInput, TableUpdateInput } from '../src/index.ts'

test('registers tables by stable logical IDs without changing query identity', () => {
  const accounts = table('account_records', { id: integer() })
  const memberships = table('membership_records', {
    accountId: integer(),
  })

  const forward = schema({ accounts, memberships }, { namespace: 'public' })
  const reverse = schema({ memberships, accounts }, { namespace: 'public' })

  expect(forward.schemaKind).toBe('schema')
  expect(forward.namespace).toBe('public')
  expect(forward.tables.accounts).toBe(accounts)
  expect(forward.registry.accounts).toMatchObject({
    id: 'accounts',
    table: accounts,
    physicalName: 'account_records',
  })
  expect(forward.tableNames).toEqual({
    accounts: 'account_records',
    memberships: 'membership_records',
  })
  expect(schemaNamingPolicyVersion).toBe(1)
  expect(generatedTableName('userID')).toBe('user_id')
  expect(reverse.registry.accounts.id).toBe(forward.registry.accounts.id)
  expect(reverse.registry.accounts.physicalName).toBe(
    forward.registry.accounts.physicalName
  )
  expect(Object.isFrozen(forward)).toBe(true)
  expect(Object.isFrozen(forward.tables)).toBe(true)
  expect(Object.isFrozen(forward.registry)).toBe(true)
  expect(Object.isFrozen(forward.registry.accounts)).toBe(true)

  expect(render(select({ id: accounts.id }, from(accounts))).text).toBe(
    'SELECT "account_records"."id" AS "id" FROM "account_records"'
  )
})

test('reports structured schema identity and naming diagnostics', () => {
  const accounts = table('accounts', { id: integer() })
  const memberships = table('accounts', { id: integer() })

  expect(() => schema({ accounts, memberships })).toThrow(SchemaValidationError)
  try {
    schema({ accounts, memberships })
  } catch (error) {
    expect(error).toBeInstanceOf(SchemaValidationError)
    expect((error as SchemaValidationError).diagnostics).toEqual([
      expect.objectContaining({
        code: 'duplicate-physical-name',
        path: ['tables', 'memberships', 'physicalName'],
      }),
    ])
    expect((error as SchemaValidationError).issues).toBe(
      (error as SchemaValidationError).diagnostics
    )
  }

  expect(() =>
    schema([
      ['accounts', accounts],
      ['accounts', table('memberships', { id: integer() })],
    ] as const)
  ).toThrowError(/declared more than once/)

  expect(() => schema({ accounts }, { namespace: 'public.accounts' })).toThrow(
    /must be a non-empty identifier/
  )

  expect(() =>
    schema(
      { accounts, memberships: table('memberships', { id: integer() }) },
      { namingPolicy: { version: 1, tableName: () => 'same_name' } }
    )
  ).toThrowError(/generate the same physical name/)
})

test('keeps unregistered tables valid query sources', () => {
  const accounts = table('accounts', { id: integer() })
  expect(render(select({ id: accounts.id }, from(accounts))).text).toBe(
    'SELECT "accounts"."id" AS "id" FROM "accounts"'
  )
})

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

test('retains structured key constraints without changing table SQL', () => {
  const accounts = table(
    'accounts',
    { tenantId: integer(), email: text(), name: text() },
    accounts => ({
      constraints: {
        accountsPrimary: primaryKey(accounts.tenantId, accounts.email),
        accountsEmailUnique: unique(accounts.email),
      },
      indexes: {},
    })
  )

  expect(accounts.constraints).toEqual({
    accountsPrimary: {
      kind: 'primary-key',
      columns: [accounts.tenantId, accounts.email],
    },
    accountsEmailUnique: {
      kind: 'unique',
      columns: [accounts.email],
    },
  })
  expectTypeOf(accounts.constraints.accountsPrimary.columns).toEqualTypeOf<
    readonly [typeof accounts.tenantId, typeof accounts.email]
  >()
  expect(alias(accounts, 'account').constraints).toBe(accounts.constraints)
  expect(render(select({ name: accounts.name }, from(accounts))).text).toBe(
    'SELECT "accounts"."name" AS "name" FROM "accounts"'
  )
})

test('retains foreign keys, checks, and portable indexes as named metadata', () => {
  const accounts = table(
    'indexed_accounts',
    {
      tenantId: integer(),
      id: integer(),
      email: text(),
      nickname: text({ nullable: true }),
    },
    accounts => ({
      constraints: {
        accountsPrimary: primaryKey(accounts.tenantId, accounts.id),
        reservedEmail: check(eq(accounts.email, value('root@example.com'))),
      },
      indexes: {
        accountsIdentity: index([accounts.tenantId, asc(accounts.id)], {
          unique: true,
        }),
        lowerEmail: index([lower(accounts.email)]),
        activeEmail: index([accounts.email], {
          unique: true,
          where: eq(accounts.email, value('active@example.com')),
        }),
        nullableNickname: index([accounts.nickname], { unique: true }),
      },
    })
  )

  const memberships = table(
    'indexed_memberships',
    { tenantId: integer(), accountId: integer() },
    memberships => ({
      constraints: {
        accountForeign: foreignKey(
          [memberships.tenantId, memberships.accountId],
          () => references(accounts, accounts.tenantId, accounts.id)
        ),
      },
      indexes: {},
    })
  )
  const widenedIndexes = table(
    'widened_indexes',
    { id: integer(), active: text() },
    indexed => {
      const predicate = eq(indexed.active, value('yes'))
      const present: {
        readonly unique: true
        readonly where?: typeof predicate
      } = { unique: true, where: predicate }
      const absent: {
        readonly unique: true
        readonly where?: typeof predicate
      } = { unique: true }
      const requiredUnion: {
        readonly unique: true
        readonly where: typeof predicate | undefined
      } = { unique: true, where: undefined }
      const optionalUnique: { readonly unique?: true } = { unique: true }
      return {
        constraints: {},
        indexes: {
          present: index([indexed.id], present),
          absent: index([indexed.id], absent),
          requiredUnion: index([indexed.id], requiredUnion),
          optionalUnique: index([indexed.id], optionalUnique),
        },
      }
    }
  )

  const handles = table('handles', { slug: text() }, handles => ({
    constraints: {},
    indexes: { handlesSlug: index([handles.slug], { unique: true }) },
  }))
  const profiles = table('profiles', { handle: text() }, profiles => ({
    constraints: {
      handleForeign: foreignKey(
        [profiles.handle],
        references(handles, handles.slug)
      ),
    },
    indexes: {},
  }))

  const employees = table(
    'employees',
    { id: integer(), managerId: integer({ nullable: true }) },
    employees => ({
      constraints: {
        employeesPrimary: primaryKey(employees.id),
        managerForeign: foreignKey(
          [employees.managerId],
          references(employees, employees.id)
        ),
      },
      indexes: {},
    })
  )

  expect(accounts.indexes.accountsIdentity).toMatchObject({
    kind: 'index',
    unique: true,
    candidateKey: true,
    predicate: undefined,
  })
  expect(accounts.indexes.lowerEmail.candidateKey).toBe(false)
  expect(accounts.indexes.activeEmail.candidateKey).toBe(false)
  expect(accounts.indexes.nullableNickname.candidateKey).toBe(false)
  expect(widenedIndexes.indexes.present).toMatchObject({
    unique: true,
    candidateKey: false,
  })
  expect(widenedIndexes.indexes.present.predicate).toBeDefined()
  expect(widenedIndexes.indexes.absent).toMatchObject({
    unique: true,
    predicate: undefined,
    candidateKey: true,
  })
  expect(widenedIndexes.indexes.requiredUnion).toMatchObject({
    unique: true,
    predicate: undefined,
    candidateKey: true,
  })
  expect(widenedIndexes.indexes.optionalUnique).toMatchObject({
    unique: true,
    predicate: undefined,
    candidateKey: true,
  })
  expectTypeOf(
    widenedIndexes.indexes.present.candidateKey
  ).toEqualTypeOf<boolean>()
  expectTypeOf(
    widenedIndexes.indexes.absent.candidateKey
  ).toEqualTypeOf<boolean>()
  expectTypeOf(
    widenedIndexes.indexes.requiredUnion.candidateKey
  ).toEqualTypeOf<boolean>()
  expectTypeOf(
    widenedIndexes.indexes.optionalUnique.unique
  ).toEqualTypeOf<boolean>()
  expect(accounts.constraints.reservedEmail).toMatchObject({ kind: 'check' })

  const lazyTarget = memberships.constraints.accountForeign.target
  expect(typeof lazyTarget).toBe('function')
  expect((lazyTarget as () => unknown)()).toEqual(
    references(accounts, accounts.tenantId, accounts.id)
  )
  expect(employees.constraints.managerForeign.target).toEqual(
    references(employees, employees.id)
  )
  expect(profiles.constraints.handleForeign.target).toEqual(
    references(handles, handles.slug)
  )

  const accountAlias = alias(accounts, 'indexed_account')
  expect(accountAlias.constraints).toBe(accounts.constraints)
  expect(accountAlias.indexes).toBe(accounts.indexes)
  expect(render(select({ email: accounts.email }, from(accounts))).text).toBe(
    'SELECT "indexed_accounts"."email" AS "email" FROM "indexed_accounts"'
  )
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
