import {
  add,
  all,
  alias,
  avg,
  bigint,
  binary,
  between,
  boolean,
  caseWhen,
  cast,
  cte,
  coalesce,
  column,
  concat,
  date,
  eq,
  from,
  inList,
  inQuery,
  integer,
  json,
  like,
  lower,
  lt,
  min,
  nullable,
  numeric,
  order,
  scalar,
  select,
  sum,
  table,
  text,
  timestamp,
  union,
  uuid,
  value,
  where,
} from '../src/index.ts'
import {
  syntax,
  typedCall,
  typedCast,
  typedValue,
  unsafeExpression,
} from '../src/core/index.ts'
import { customSource } from '../src/schema/index.ts'
import type {
  SqlBigInt,
  SqlBinary,
  SqlBoolean,
  SqlDate,
  SqlDecimal,
  SqlInteger,
  SqlText,
  SqlTimestamp,
  SqlTypeOf,
  SqlUnknown,
  SqlUuid,
  RequiresOf,
  SourceIdentity,
  RequiresOuterOf,
  FieldLike,
  SourceLike,
  TableLike,
  SqlTextLike,
  AnySqlType,
  SqlEqualityCompatible,
  SqlSemanticType,
  SqlOrderable,
  OutputOf,
  NullabilityOf,
} from '../src/index.ts'
import { ilike } from '../src/dialects/postgres.ts'
import type { ResultExpression } from '../src/expressions/types.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false
type Assert<TCondition extends true> = TCondition

const records = table('records', {
  id: uuid(),
  label: text(),
  count: integer(),
})

type MinimalResultExpression = ResultExpression<{ readonly output: string }>

export type SparseResultExpressionDefaults = Assert<
  Equal<
    [
      OutputOf<MinimalResultExpression>,
      NullabilityOf<MinimalResultExpression>,
      SqlTypeOf<MinimalResultExpression>,
    ],
    [string, never, SqlUnknown]
  >
>

type ChildResultExpression = ResultExpression<{
  readonly output: string
  readonly children: typeof records.label
}>

export type ResultExpressionDefaultsFollowChildren = Assert<
  Equal<
    NullabilityOf<ChildResultExpression>,
    NullabilityOf<typeof records.label>
  >
>

// @ts-expect-error Result SQL domains must use Qubu SQL semantic types.
type InvalidResultExpressionConfig = ResultExpression<{
  readonly sqlType: string
}>

function byStringId<TTable extends TableLike<{ id: string }>>(
  source: TTable,
  id: string
) {
  return where(eq(source.columns.id, id))
}

type NonNullTextId = FieldLike<{
  sqlType: SqlTextLike
  nullable: false
}>

function byTextId<TSource extends SourceLike<{ id: NonNullTextId }>>(
  source: TSource,
  id: string
) {
  return where(eq(source.columns.id, id))
}

function preserveStringIdTable<TTable extends TableLike<{ id: string }>>(
  source: TTable
) {
  return source
}

const textIds = table('text_ids', { id: text(), extra: integer() })
const nullableTextIds = table('nullable_text_ids', {
  id: nullable(text()),
})
const numericIds = table('numeric_ids', { id: integer() })
const missingIds = table('missing_ids', { label: text() })
const legacyIds = table('legacy_ids', { id: column<string>() })
const textIdsAlias = alias(textIds, 'text_ids_alias')
const customLegacyIds = customSource({
  identity: { sourceKind: 'custom-legacy-ids' } as const,
  render: context => context.append('custom_legacy_ids()'),
  reference: syntax('custom_legacy_ids'),
  columns: { id: column<string>() },
})

const stringIdFragment = byStringId(textIds, 'one')
const textIdFragment = byTextId(textIdsAlias, 'one')
const customTextIdFragment = byTextId(customLegacyIds, 'one')
const preservedTextIds = preserveStringIdTable(textIds)
preservedTextIds.extra

export type GenericFragmentScope = Assert<
  Equal<
    [
      RequiresOf<typeof stringIdFragment>,
      RequiresOuterOf<typeof stringIdFragment>,
      RequiresOf<typeof textIdFragment>,
      RequiresOuterOf<typeof textIdFragment>,
      RequiresOf<typeof customTextIdFragment>,
      RequiresOuterOf<typeof customTextIdFragment>,
    ],
    [
      SourceIdentity<typeof textIds>,
      never,
      SourceIdentity<typeof textIdsAlias>,
      never,
      SourceIdentity<typeof customLegacyIds>,
      never,
    ]
  >
>

export type AbstractSqlDomainsStayOpen = Assert<
  Equal<
    [
      SqlEqualityCompatible<AnySqlType, SqlUuid>,
      SqlEqualityCompatible<SqlText, SqlUuid>,
    ],
    [true, false]
  >
>

byStringId(records, 'uuid-is-a-js-string')
byTextId(legacyIds, 'legacy-unknown-is-permissive')

// @ts-expect-error Nullable strings do not satisfy the non-null JS requirement.
byStringId(nullableTextIds, 'nullable')

// @ts-expect-error Numeric JS output does not satisfy a string id requirement.
byStringId(numericIds, 'numeric')

// @ts-expect-error The required id field is missing.
byStringId(missingIds, 'missing')

// @ts-expect-error UUID is string-decoded but is not SQL text-like.
byTextId(records, 'uuid')

// @ts-expect-error Nullable SQL text does not satisfy nullable: false.
byTextId(nullableTextIds, 'nullable')

const added = add(records.count, 1)
const averaged = avg(records.count)
const lowered = lower(records.label)
const predicate = eq(records.id, '108cb836-20d2-41b2-8c23-f0c94700aa7e')
const conditional = caseWhen(predicate, records.label, 'missing')

export type BuiltInPropagation = Assert<
  Equal<
    [
      SqlTypeOf<typeof added>,
      SqlTypeOf<typeof averaged>,
      SqlTypeOf<typeof lowered>,
      SqlTypeOf<typeof predicate>,
      SqlTypeOf<typeof conditional>,
    ],
    [SqlInteger, SqlDecimal, SqlText, SqlBoolean, SqlText]
  >
>

const projected = select(
  { id: records.id, label: lower(records.label) },
  from(records)
)
const projectedAll = select(all(records), from(records))
const projectedAlias = alias(projected, 'projected_records')
const projectedAllAlias = alias(projectedAll, 'all_records')
const projectedCte = cte('projected_records_cte', projected)
const projectedScalar = scalar(select({ id: records.id }, from(records)))

export type DerivedSourcePropagation = Assert<
  Equal<
    [
      SqlTypeOf<typeof projectedAlias.id>,
      SqlTypeOf<typeof projectedCte.label>,
      SqlTypeOf<typeof projectedScalar>,
      SqlTypeOf<typeof projectedAllAlias.id>,
    ],
    [SqlUuid, SqlText, SqlUuid, SqlUuid]
  >
>

const explicitCast = cast<string, SqlText, typeof records.id>(
  records.id,
  'TEXT'
)
const ergonomicCast = typedCast<string, SqlText>()(records.id, 'TEXT')
const definitionCast = cast(records.id, text())
const narrowedDefinitionCast = cast(
  records.id,
  text().$type<'primary' | 'secondary'>()
)

interface SqlCitext
  extends SqlSemanticType<'postgres.citext'>,
    SqlTextLike,
    SqlOrderable<'text'> {}

const citext = column<string, string, string, SqlCitext>({ castType: 'CITEXT' })
const customDefinitionCast = cast(records.label, citext)
const builtInDefinitionCasts = [
  cast(records.id, integer()),
  cast(records.id, numeric()),
  cast(records.id, text()),
  cast(records.id, boolean()),
  cast(records.id, date()),
  cast(records.id, timestamp()),
  cast(records.id, uuid()),
  cast(records.id, json<{ id: string }>()),
  cast(records.id, bigint()),
  cast(records.id, binary()),
] as const
const customCall = typedCall<SqlText, string>()('custom_text', records.label)
const customValue = typedValue<SqlUuid, string>('uuid-value')
const customUnsafe = unsafeExpression<string, SqlText>('custom_text()')

export type CastPropagation = Assert<
  Equal<
    [
      SqlTypeOf<typeof explicitCast>,
      SqlTypeOf<typeof ergonomicCast>,
      SqlTypeOf<typeof definitionCast>,
      SqlTypeOf<typeof narrowedDefinitionCast>,
      OutputOf<typeof definitionCast>,
      RequiresOf<typeof definitionCast>,
      NullabilityOf<typeof definitionCast>,
      SqlTypeOf<typeof customDefinitionCast>,
    ],
    [
      SqlText,
      SqlText,
      SqlText,
      SqlText,
      string,
      SourceIdentity<typeof records>,
      SourceIdentity<typeof records>,
      SqlCitext,
    ]
  >
>
export type BuiltInCastDomains = Assert<
  Equal<
    [
      SqlTypeOf<(typeof builtInDefinitionCasts)[0]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[1]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[2]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[3]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[4]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[5]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[6]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[7]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[8]>,
      SqlTypeOf<(typeof builtInDefinitionCasts)[9]>,
    ],
    [
      SqlInteger,
      SqlDecimal,
      SqlText,
      SqlBoolean,
      SqlDate,
      SqlTimestamp,
      SqlUuid,
      import('../src/index.ts').SqlJson<{ id: string }>,
      SqlBigInt,
      SqlBinary,
    ]
  >
>

// @ts-expect-error Cast targets do not accept schema nullability flags.
cast(records.id, text({ nullable: true }))

// @ts-expect-error A custom definition needs an explicit runtime cast type.
cast(records.id, column<string>())

// @ts-expect-error Built-in helpers use their dialect-resolved logical target.
text({ castType: 'CITEXT' })
export type CallPropagation = Assert<
  Equal<
    [SqlTypeOf<typeof customCall>, RequiresOf<typeof customCall>],
    [SqlText, SourceIdentity<typeof records>]
  >
>
export type ValuePropagation = Assert<
  Equal<SqlTypeOf<typeof customValue>, SqlUuid>
>
export type UnsafePropagation = Assert<
  Equal<SqlTypeOf<typeof customUnsafe>, SqlText>
>
export type DefaultValueSemantics = Assert<
  Equal<SqlTypeOf<ReturnType<typeof value<string>>>, SqlUnknown>
>

eq(records.id, 'uuid-value')
inList(records.id, ['one', 'two'])
inQuery(records.id, select({ id: records.id }, from(records)))
where(unsafeExpression<boolean>('legacy_boolean()'))
ilike(records.label, '%label%')
union(
  select({ value: records.id }, from(records)),
  select({ value: records.id }, from(records))
)

// @ts-expect-error UUID and text expressions have incompatible equality domains.
eq(records.id, records.label)

// @ts-expect-error UUID is not text-like.
like(records.id, '%uuid%')

// @ts-expect-error UUID is not text-like.
lower(records.id)

// @ts-expect-error UUID has equality but no portable ordering relation.
lt(records.id, 'uuid-value')

// @ts-expect-error Text is not a numeric SQL domain.
add(records.label, 'suffix')

// @ts-expect-error A text expression is not a compatible numeric operand.
add(records.count, records.label)

// @ts-expect-error BETWEEN bounds must share the expression's ordering domain.
between(records.count, records.label, 10)

// @ts-expect-error IN expressions must share the expression's equality domain.
inList(records.id, [records.label])

// @ts-expect-error IN subqueries require a compatible SQL result domain.
inQuery(records.id, select({ label: records.label }, from(records)))

inQuery(
  // @ts-expect-error IN subqueries must select exactly one field.
  records.id,
  select({ id: records.id, label: records.label }, from(records))
)

// @ts-expect-error SUM accepts numeric SQL domains.
sum(records.label)

// @ts-expect-error UUID is not portably orderable.
min(records.id)

// @ts-expect-error UUID is not portably orderable.
order(records.id)

// @ts-expect-error COALESCE branches must have compatible SQL domains.
coalesce(records.id, records.label)

// @ts-expect-error CONCAT accepts only text-like expression domains.
concat(records.label, records.id)

// @ts-expect-error A known text SQL domain is not a boolean condition.
where(unsafeExpression<boolean, SqlText>('not_boolean'))

// @ts-expect-error PostgreSQL ILIKE is text-like and does not accept UUID.
ilike(records.id, '%uuid%')

union(
  // @ts-expect-error Set-operation fields require compatible SQL domains.
  select({ value: records.id }, from(records)),
  select({ value: records.label }, from(records))
)
