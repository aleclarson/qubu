import {
  cast,
  correlate,
  from,
  integer,
  recursiveCte,
  select,
  table,
  text,
  value,
  where,
} from '../src/index.ts'
import { ilike } from '../src/dialects/postgres.ts'
import type {
  CapabilitiesOf,
  NullabilityOf,
  RequiresOuterOf,
  SourceIdentity,
  SourceRow,
  SqlInteger,
  SqlText,
  SqlTypeOf,
} from '../src/index.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false
type Assert<TCondition extends true> = TCondition

const records = table('recursive_records', {
  id: integer(),
  label: text(),
})

const anchor = select({ id: records.id, label: records.label }, from(records))
const recursive = recursiveCte('recursive_records', anchor, self =>
  select({ id: self.id, label: self.label }, from(self))
)

export type RecursiveRowPreservesAnchor = Assert<
  Equal<SourceRow<typeof recursive>, { id: number; label: string }>
>
export type RecursiveDomainsPreserveAnchor = Assert<
  Equal<
    [SqlTypeOf<typeof recursive.id>, SqlTypeOf<typeof recursive.label>],
    [SqlInteger, SqlText]
  >
>
export type RecursiveNullabilityPreservesAnchor = Assert<
  Equal<NullabilityOf<typeof recursive.id>, SourceIdentity<typeof recursive>>
>
export type RecursiveOuterRequirementsDoNotIncludeSelf = Assert<
  Equal<RequiresOuterOf<typeof recursive>, never>
>
export type RecursiveCoreSyntaxHasNoCapabilityRequirement = Assert<
  Equal<CapabilitiesOf<typeof recursive>, never>
>

const correlatedAnchor = select(
  { id: records.id, label: records.label },
  correlate(records)
)
const correlatedRecursive = recursiveCte(
  'correlated_recursive_records',
  correlatedAnchor,
  self =>
    select({ id: self.id, label: self.label }, from(self), correlate(records))
)
export type RecursiveOuterRequirementsPropagate = Assert<
  Equal<
    RequiresOuterOf<typeof correlatedRecursive>,
    SourceIdentity<typeof records>
  >
>

const capableRecursive = recursiveCte(
  'capable_recursive_records',
  anchor,
  self =>
    select(
      { id: self.id, label: self.label },
      from(self),
      // The member's dialect-specific expression remains visible at the CTE boundary.
      where(ilike(self.label, '%record%'))
    )
)
export type RecursiveMemberCapabilitiesPropagate = Assert<
  Equal<CapabilitiesOf<typeof capableRecursive>, 'ilike'>
>

recursiveCte('recursive_records', anchor, self =>
  select({ id: self.id, label: self.label }, from(self))
)

recursiveCte('missing_self_scope', anchor, self =>
  // @ts-expect-error A member column still needs its self source in FROM or JOIN.
  select({ id: self.id, label: self.label })
)

// @ts-expect-error The recursive member must provide every anchor field.
recursiveCte('missing_field', anchor, self =>
  select({ id: self.id }, from(self))
)

// @ts-expect-error The recursive member cannot add fields outside the anchor projection.
recursiveCte('extra_field', anchor, self =>
  select({ id: self.id, label: self.label, extra: self.id }, from(self))
)

// @ts-expect-error The recursive member's application type must be compatible with the anchor.
recursiveCte('wrong_application_type', anchor, self =>
  select({ id: value('wrong'), label: self.label }, from(self))
)

// @ts-expect-error The recursive member's SQL domain must be compatible with the anchor.
recursiveCte('wrong_sql_domain', anchor, self =>
  select({ id: cast(self.id, text()), label: self.label }, from(self))
)
