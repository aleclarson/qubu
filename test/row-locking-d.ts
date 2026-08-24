import { expectTypeOf } from 'vitest'
import type {
  CapabilitiesOf,
  Dialect,
  DialectCapability,
  MetadataOf,
  QuerySqlTypeMap,
  RequiresCapabilityMeta,
  RowLockClause,
  RowLockMode,
  RowLockWaitPolicy,
} from '../src/index.ts'
import {
  eq,
  from,
  integer,
  render,
  rowLock,
  select,
  table,
  text,
  where,
} from '../src/index.ts'
import { mysqlDialect } from '../src/dialects/mysql.ts'
import { postgresDialect } from '../src/dialects/postgres.ts'
import { sqliteDialect } from '../src/dialects/sqlite.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

export type RowLockCapabilityIsPartOfTheVocabulary = Assert<
  Equal<DialectCapability, 'ilike' | 'json' | 'on-conflict' | 'row-locking'>
>

export type RowLockModesAreTyped = Assert<
  Equal<RowLockMode, 'update' | 'no-key-update' | 'share' | 'key-share'>
>

export type RowLockWaitPoliciesAreTyped = Assert<
  Equal<RowLockWaitPolicy, 'default' | 'nowait' | 'skip-locked'>
>

const users = table('users', { id: integer(), email: text({ nullable: true }) })
const lock = rowLock('no-key-update', 'skip-locked')

export type LiteralLockArgumentsAreRetained = Assert<
  Equal<typeof lock, RowLockClause<'no-key-update', 'skip-locked'>>
>

export type RowLockCarriesOnlyItsCapability = Assert<
  Equal<CapabilitiesOf<typeof lock>, 'row-locking'>
>

export type RowLockCapabilityMetadataIsTagged = Assert<
  Equal<
    Extract<MetadataOf<typeof lock>, { readonly kind: 'requires-capability' }>,
    RequiresCapabilityMeta<'row-locking'>
  >
>

const query = select(
  { id: users.id, email: users.email },
  where(eq(users.id, 7)),
  lock,
  from(users)
)

expectTypeOf(query.row).toEqualTypeOf<{
  id: number
  email: string | null
}>()
export type QuerySqlTypesArePreserved = Assert<
  Equal<
    QuerySqlTypeMap<typeof query>,
    {
      id: import('../src/index.ts').SqlInteger
      email: import('../src/index.ts').SqlText
    }
  >
>

render(query, postgresDialect())
render(
  select({ id: users.id }, from(users), rowLock('update', 'nowait')),
  mysqlDialect()
)

expectTypeOf(postgresDialect()).toMatchTypeOf<
  Dialect<'ilike' | 'json' | 'on-conflict' | 'row-locking'>
>()

// @ts-expect-error The standard dialect does not advertise row locking.
render(query)

// @ts-expect-error SQLite does not advertise row locking.
render(query, sqliteDialect())

// @ts-expect-error Lock modes are a closed vocabulary.
rowLock('invalid-mode')

// @ts-expect-error Wait policies are a closed vocabulary.
rowLock('update', 'invalid-wait')
