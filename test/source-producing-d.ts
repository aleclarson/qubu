import type {
  ColumnDependency,
  DependenciesOf,
  MetadataOf,
  NullableSourcesOf,
  OutputOf,
  ProvidedSourceIdentity,
  ProvidedSourceRow,
  ProvidesSourceMeta,
  RequiresOf,
  SourceIdentity,
  Source,
  SourceProvision,
  SourceRow,
  SourceSqlTypeMap,
  SqlUnknown,
} from "../src/index.ts"
import { from, select, where, eq } from "../src/index.ts"
import {
  entries,
  entriesQuery,
  joinedEntriesClause,
  joinedEntriesQuery,
  users,
} from "./source-producing-fixtures.ts"

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

type EntryIdentity = SourceIdentity<typeof entries>
type EntryRow = SourceRow<typeof entries>

declare const sparseSource: Source<{
  readonly identity: "sparse-source"
  readonly row: {
    readonly id: number
    readonly label: string
  }
}>

export type SparseSourceIdentity = Assert<
  Equal<SourceIdentity<typeof sparseSource>, "sparse-source">
>

export type SparseSourceRow = Assert<
  Equal<
    SourceRow<typeof sparseSource>,
    {
      readonly id: number
      readonly label: string
    }
  >
>

export type SparseSourceDefaultsSqlTypes = Assert<
  Equal<
    SourceSqlTypeMap<typeof sparseSource>,
    {
      readonly id: SqlUnknown
      readonly label: SqlUnknown
    }
  >
>

export type SourceProvisionIsPrecise = Assert<
  Equal<SourceProvision<typeof entries>, ProvidesSourceMeta<EntryIdentity, EntryRow>>
>

export type SourceIdentityComesFromProvision = Assert<
  Equal<ProvidedSourceIdentity<typeof entries>, EntryIdentity>
>

export type SourceRowComesFromProvision = Assert<Equal<ProvidedSourceRow<typeof entries>, EntryRow>>

export type SourceRowShape = Assert<
  Equal<
    EntryRow,
    {
      key: number
      value: string | null
    }
  >
>

export type SourceProvisionMetadataIsAvailableToComposition = Assert<
  Equal<
    Extract<MetadataOf<typeof entries>, { readonly kind: "provides-source" }>,
    ProvidesSourceMeta<EntryIdentity, EntryRow>
  >
>

export type SourceRequirementsRemainPrecise = Assert<
  Equal<RequiresOf<typeof entries.value>, EntryIdentity>
>

export type SourceOutputRemainsPrecise = Assert<
  Equal<
    OutputOf<typeof entriesQuery>,
    readonly {
      key: number
      value: string | null
    }[]
  >
>

export type SourceDependenciesRemainPrecise = Assert<
  Equal<DependenciesOf<typeof entries.value>, ColumnDependency<EntryIdentity, "value">>
>

export type JoinedSourceNullabilityRemainsClauseDriven = Assert<
  Equal<NullableSourcesOf<typeof joinedEntriesClause>, EntryIdentity>
>

export type JoinedSourceOutputRemainsSound = Assert<
  Equal<
    typeof joinedEntriesQuery.row,
    {
      userId: number
      value: string | null
      total: number
    }
  >
>

select({ value: entries.value }, from(entries))

// @ts-expect-error A produced source must be introduced by FROM or JOIN.
select({ value: entries.value })

// @ts-expect-error A clause cannot consume a produced source that is absent from scope.
select({ id: users.id }, from(users), where(eq(entries.key, 7)))
