import { expectTypeOf } from 'vitest'
import {
  count,
  from,
  groupBy,
  index,
  integer,
  primaryKey,
  select,
  table,
  text,
  unique,
  uniqueConstraint,
} from '../src/index.ts'
import type {
  ConstraintDialectExtension,
  IndexDialectExtension,
  UniqueNullSemantics,
} from '../src/index.ts'

const accounts = table(
  'typed_constraint_accounts',
  {
    id: integer(),
    nullableCode: text({ nullable: true }),
    code: text(),
  },
  accounts => ({
    constraints: {
      accountsPrimary: primaryKey(accounts.id, {
        physicalName: 'typed_accounts_pk',
        dialect: { dialect: 'postgresql', notValid: false },
      }),
      nullableCodeUnique: uniqueConstraint(accounts.nullableCode, {
        nulls: 'not-distinct',
        dialect: { dialect: 'postgresql' },
      }),
      codeUnique: unique(accounts.code),
    },
    indexes: {
      codeIndex: index([accounts.code], {
        include: [accounts.nullableCode],
        dialect: {
          dialect: 'postgresql',
          method: 'btree',
          concurrently: true,
          operatorClasses: { code: 'text_ops' },
          storageParameters: { fillfactor: 90 },
        },
      }),
    },
  })
)

expectTypeOf(
  accounts.constraints.nullableCodeUnique.nulls
).toEqualTypeOf<'not-distinct'>()
expectTypeOf(
  accounts.constraints.nullableCodeUnique.kind
).toEqualTypeOf<'unique-constraint'>()
expectTypeOf(accounts.constraints.accountsPrimary.physicalName).toEqualTypeOf<
  string | undefined
>()
expectTypeOf(accounts.indexes.codeIndex.includedColumns).toEqualTypeOf<
  readonly [typeof accounts.nullableCode] | undefined
>()
expectTypeOf(accounts.indexes.codeIndex.dialect).toMatchTypeOf<
  IndexDialectExtension | undefined
>()

type ConstraintExtension = ConstraintDialectExtension
type NullSemantics = UniqueNullSemantics
const extension: ConstraintExtension = { dialect: 'sqlite' }
const nullSemantics: NullSemantics = 'distinct'
void extension
void nullSemantics

const summary = select(
  { code: accounts.code, total: count() },
  // @ts-expect-error A nullable unique constraint is not a candidate-key proof.
  from(accounts),
  groupBy(accounts.nullableCode)
)
void summary

table(
  'typed_constraint_invalid_unique',
  { nullableCode: text({ nullable: true }) },
  invalid => ({
    constraints: {
      // @ts-expect-error unique() remains the strict non-null candidate-key declaration.
      invalidUnique: unique(invalid.nullableCode),
    },
    indexes: {},
  })
)

const other = table('typed_constraint_other', { id: integer() })
table(
  'typed_constraint_invalid_index_include',
  { id: integer() },
  // @ts-expect-error Included columns must belong to the callback table.
  invalid => ({
    constraints: {},
    indexes: {
      invalidInclude: index([invalid.id], { include: [other.id] }),
    },
  })
)

const invalidAction = {
  // @ts-expect-error Foreign-key actions use the finite standard vocabulary.
  onDelete: 'delete-all',
} satisfies import('../src/index.ts').ForeignKeyOptions
void invalidAction
