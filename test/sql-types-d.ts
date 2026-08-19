import {
  alias,
  bigint,
  binary,
  boolean,
  column,
  customSource,
  date,
  integer,
  json,
  nullable,
  numeric,
  table,
  syntax,
  text,
  timestamp,
  uuid,
} from '../src/index.ts'
import type {
  ColumnSqlType,
  FieldLike,
  SourceIdentity,
  SourceLike,
  SqlEqualityComparable,
  SqlBigInt,
  SqlBinary,
  SqlBoolean,
  SqlDate,
  SqlDecimal,
  SqlInteger,
  SqlJson,
  SqlEqualityCompatible,
  SqlOrderCompatible,
  SqlOrderable,
  SqlSemanticType,
  SqlText,
  SqlTextLike,
  SqlTimestamp,
  SqlTypeOf,
  SqlUnknown,
  SqlUuid,
  TableLike,
} from '../src/index.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

const records = table('records', {
  id: uuid(),
  label: text(),
  nullableLabel: text({ nullable: true }),
  sequence: integer(),
  legacy: column<string>(),
  amount: numeric(),
  active: boolean(),
  birthday: date(),
  createdAt: timestamp(),
  payload: json<{ ok: boolean }>(),
  largeSequence: bigint(),
  bytes: binary(),
})

export type BuiltInColumnDomains = Assert<
  Equal<
    [
      SqlTypeOf<typeof records.id>,
      SqlTypeOf<typeof records.label>,
      SqlTypeOf<typeof records.sequence>,
      SqlTypeOf<typeof records.legacy>,
    ],
    [SqlUuid, SqlText, SqlInteger, SqlUnknown]
  >
>

export type RemainingBuiltInColumnDomains = Assert<
  Equal<
    [
      SqlTypeOf<typeof records.amount>,
      SqlTypeOf<typeof records.active>,
      SqlTypeOf<typeof records.birthday>,
      SqlTypeOf<typeof records.createdAt>,
      SqlTypeOf<typeof records.payload>,
      SqlTypeOf<typeof records.largeSequence>,
      SqlTypeOf<typeof records.bytes>,
    ],
    [
      SqlDecimal,
      SqlBoolean,
      SqlDate,
      SqlTimestamp,
      SqlJson<{ ok: boolean }>,
      SqlBigInt,
      SqlBinary,
    ]
  >
>

export type TextCapabilities = Assert<
  SqlText extends SqlTextLike & SqlOrderable & SqlEqualityComparable<'text'>
    ? true
    : false
>

export type UuidIsNotTextLike = Assert<
  SqlUuid extends SqlTextLike ? false : true
>

interface SqlCitext
  extends SqlSemanticType<'postgres.citext'>,
    SqlTextLike,
    SqlOrderable<'text'>,
    SqlEqualityComparable<'text'> {}

export type KnownCompatibility = Assert<
  Equal<
    [
      SqlEqualityCompatible<SqlText, SqlCitext>,
      SqlEqualityCompatible<SqlText, SqlUuid>,
      SqlOrderCompatible<SqlInteger, SqlDecimal>,
      SqlOrderCompatible<SqlInteger, SqlText>,
      SqlEqualityCompatible<SqlUnknown, SqlUuid>,
    ],
    [true, false, true, false, true]
  >
>

const citext = column<string, string, string, SqlCitext>()
const nullableCitext = nullable(citext)

export type CustomColumnDomain = Assert<
  Equal<ColumnSqlType<typeof nullableCitext>, SqlCitext>
>

function applicationStringId<TTable extends TableLike<{ id: string }>>(
  source: TTable
) {
  return source
}

function nonNullTextId<
  TSource extends SourceLike<{
    id: FieldLike<{ sqlType: SqlTextLike; nullable: false }>
  }>,
>(source: TSource) {
  return source
}

const textIds = table('text_ids', { id: text(), extra: integer() })
const nullableTextIds = table('nullable_text_ids', {
  id: text({ nullable: true }),
})
const unknownIds = table('unknown_ids', { id: column<string>() })
const aliasedTextIds = alias(textIds, 'aliased_text_ids')
const customTextIds = customSource({
  identity: { sourceKind: 'custom-text-ids' } as const,
  render: context => context.append('custom_text_ids()'),
  reference: syntax('custom_text_ids'),
  columns: { id: text() },
})

const sameTable = applicationStringId(textIds)
const sameAlias = nonNullTextId(aliasedTextIds)
nonNullTextId(textIds)
nonNullTextId(unknownIds)
nonNullTextId(customTextIds)

export type TableIdentityIsPreserved = Assert<
  Equal<SourceIdentity<typeof sameTable>, SourceIdentity<typeof textIds>>
>

export type AliasIdentityIsPreserved = Assert<
  Equal<SourceIdentity<typeof sameAlias>, SourceIdentity<typeof aliasedTextIds>>
>

export type AliasSqlDomainIsPreserved = Assert<
  Equal<SqlTypeOf<typeof aliasedTextIds.id>, SqlText>
>

export type CustomSourceSqlDomainIsPreserved = Assert<
  Equal<SqlTypeOf<typeof customTextIds.id>, SqlText>
>

applicationStringId(records)

// @ts-expect-error Nullable strings do not satisfy a non-null JS requirement.
applicationStringId(nullableTextIds)

// @ts-expect-error UUID is string-decoded but is not SQL text-like.
nonNullTextId(records)

// @ts-expect-error Nullable SQL text does not satisfy nullable: false.
nonNullTextId(nullableTextIds)

// @ts-expect-error The required id field is missing.
nonNullTextId(table('missing_ids', { name: text() }))
