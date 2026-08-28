import { identifier } from '../core/primitives/identifier.ts'
import { resolveSqlNames } from '../core/naming.ts'
import type {
  DependenciesOf,
  HasAggregate,
  HasSubquery,
  HasWindow,
  SqlTypeOf,
} from '../core/fragment.ts'
import {
  createColumnReference,
  type ColumnDependency,
  type ColumnReference,
} from '../expressions/column.ts'
import {
  createSource,
  exposeColumns,
  type Source,
  type SourceColumns,
  type SourceIdentity,
} from './source.ts'
import {
  type ColumnDefinition,
  type ColumnHasDefault,
  type ColumnInsertInput,
  type ColumnIsGenerated,
  type ColumnIsNullable,
  type ColumnOutput,
  type ColumnSqlType,
  type ColumnUpdateInput,
  columnResultValue,
} from './column.ts'
import type { DeclaredColumnNullability } from './column-nullability.ts'
import type {
  CheckConstraint,
  ForeignKeyConstraint,
  ForeignKeyTarget,
  KeyConstraint,
  UniqueConstraint,
  SourceConstraintsRecord,
} from './constraints.ts'
import type { IndexTerm, SourceIndexesRecord } from './indexes.ts'
import { materializeSchemaObjectRecord } from './metadata.ts'
import type { AnyExpression } from '../expressions/types.ts'
import type { SqlBoolean } from '../core/sql-types.ts'
import type { OrderTerm } from '../query/clauses/order-by.ts'

export type TableDefinitions = Record<string, ColumnDefinition<any>>

export type AnyTable = Source<any> & {
  readonly tableName: string
  readonly definitions: TableDefinitions
  /** Application field keys mapped to physical SQL column names. */
  readonly sqlNames: Readonly<Record<string, string>>
}

export type TableRow<TDefinitions extends TableDefinitions> = {
  -readonly [K in keyof TDefinitions]: ColumnOutput<TDefinitions[K]>
}

/** SQL semantic domains derived from a table's column definitions. */
export type TableSqlTypes<TDefinitions extends TableDefinitions> = {
  readonly [K in keyof TDefinitions]: ColumnSqlType<TDefinitions[K]>
}

type RequiredInsertKeys<TDefinitions extends TableDefinitions> = {
  [K in keyof TDefinitions]-?: ColumnHasDefault<TDefinitions[K]> extends true
    ? never
    : ColumnIsGenerated<TDefinitions[K]> extends true
      ? never
      : K
}[keyof TDefinitions]

type OptionalInsertKeys<TDefinitions extends TableDefinitions> = Exclude<
  keyof TDefinitions,
  RequiredInsertKeys<TDefinitions>
>

export type TableInsertInput<TDefinitions extends TableDefinitions> = {
  -readonly [K in RequiredInsertKeys<TDefinitions>]: ColumnInsertInput<
    TDefinitions[K]
  >
} & {
  -readonly [K in OptionalInsertKeys<TDefinitions>]?: ColumnInsertInput<
    TDefinitions[K]
  >
}

export type TableUpdateInput<TDefinitions extends TableDefinitions> = {
  -readonly [K in keyof TDefinitions as ColumnIsGenerated<
    TDefinitions[K]
  > extends true
    ? never
    : K]?: ColumnUpdateInput<TDefinitions[K]>
}

export type TableIdentity<TName extends string> = {
  readonly sourceKind: 'table'
  readonly tableName: TName
}

export type TableColumns<TDefinitions extends TableDefinitions, TIdentity> = {
  readonly [K in keyof TDefinitions]: SourceColumns<
    TableRow<TDefinitions>,
    TIdentity,
    TableSqlTypes<TDefinitions>
  >[K] &
    DeclaredColumnNullability<ColumnIsNullable<TDefinitions[K]>>
}

export type Table<
  TName extends string = string,
  TDefinitions extends TableDefinitions = TableDefinitions,
  TConstraints extends SourceConstraintsRecord = {},
  TIndexes extends SourceIndexesRecord = {},
> = Source<{
  readonly identity: TableIdentity<TName>
  readonly row: TableRow<TDefinitions>
  readonly sqlTypes: TableSqlTypes<TDefinitions>
  readonly constraints: TConstraints
}> & {
  readonly tableName: TName
  readonly definitions: TDefinitions
  /** Application field keys mapped to physical SQL column names. */
  readonly sqlNames: Readonly<Record<keyof TDefinitions & string, string>>
  readonly columns: TableColumns<TDefinitions, TableIdentity<TName>>
  readonly constraints: TConstraints
  readonly indexes: TIndexes
} & TableColumns<TDefinitions, TableIdentity<TName>>

/** Schema metadata that applies to a table as a relation. */
export interface TableOptions<
  TConstraints extends SourceConstraintsRecord = SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord = SourceIndexesRecord,
> {
  readonly constraints: TConstraints
  readonly indexes: TIndexes
}

type ConstraintColumns<TConstraint> = TConstraint extends
  | KeyConstraint<any, infer TColumns>
  | UniqueConstraint<infer TColumns>
  | ForeignKeyConstraint<infer TColumns, any>
  ? TColumns[number]
  : never

type InvalidConstraintDependencies<
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
> = Exclude<
  DependenciesOf<ConstraintColumns<TConstraints[keyof TConstraints]>>,
  ColumnDependency<TableIdentity<TName>, string>
>

type InvalidExpression<
  TExpression,
  TName extends string,
> = TExpression extends AnyExpression
  ? Exclude<
      DependenciesOf<TExpression>,
      ColumnDependency<TableIdentity<TName>, string>
    > extends never
    ? HasAggregate<TExpression> extends true
      ? TExpression
      : HasWindow<TExpression> extends true
        ? TExpression
        : HasSubquery<TExpression> extends true
          ? TExpression
          : never
    : TExpression
  : TExpression

type ResolvedTarget<T> = T extends () => infer TResolved ? TResolved : T

type SameColumnTuple<
  TLeft extends readonly unknown[],
  TRight extends readonly unknown[],
> = TLeft extends readonly [infer TLeftHead, ...infer TLeftTail]
  ? TRight extends readonly [infer TRightHead, ...infer TRightTail]
    ? [DependenciesOf<TLeftHead>] extends [DependenciesOf<TRightHead>]
      ? [DependenciesOf<TRightHead>] extends [DependenciesOf<TLeftHead>]
        ? SameColumnTuple<TLeftTail, TRightTail>
        : false
      : false
    : false
  : TRight extends readonly []
    ? true
    : false

type IndexTermExpression<T> = T extends OrderTerm<any> ? T['expression'] : T
type IndexColumns<TTerms extends readonly IndexTerm[]> = {
  [K in keyof TTerms]: IndexTermExpression<TTerms[K]>
}
type IndexIncludedColumns<TIndex> = TIndex extends {
  readonly includedColumns?: infer TIncluded
}
  ? Exclude<TIncluded, undefined> extends readonly unknown[]
    ? Exclude<TIncluded, undefined>
    : never
  : never

type InvalidIncludedColumns<
  TIncluded,
  TName extends string,
> = TIncluded extends readonly unknown[]
  ? Exclude<
      DependenciesOf<TIncluded[number]>,
      ColumnDependency<TableIdentity<TName>, string>
    >
  : never

type ConstraintsOf<T> = T extends {
  readonly constraints: infer TConstraints extends SourceConstraintsRecord
}
  ? TConstraints
  : {}
type IndexesOf<T> = T extends {
  readonly indexes: infer TIndexes extends SourceIndexesRecord
}
  ? TIndexes
  : {}

type HasMatchingConstraint<TColumns, TConstraints> =
  TConstraints extends SourceConstraintsRecord
    ? true extends {
        [K in keyof TConstraints]: TConstraints[K] extends infer TConstraint
          ? TConstraint extends {
              readonly kind: 'primary-key' | 'unique'
              readonly columns: infer TCandidate extends readonly unknown[]
            }
            ? TColumns extends readonly unknown[]
              ? SameColumnTuple<TColumns, TCandidate>
              : false
            : false
          : false
      }[keyof TConstraints]
      ? true
      : false
    : false

type HasMatchingIndex<TColumns, TIndexes> = TIndexes extends SourceIndexesRecord
  ? true extends {
      [K in keyof TIndexes]: TIndexes[K] extends infer TIndex
        ? TIndex extends {
            readonly terms: infer TTerms extends readonly IndexTerm[]
            readonly candidateKey: infer TCandidateKey
          }
          ? [TCandidateKey] extends [true]
            ? TColumns extends readonly unknown[]
              ? SameColumnTuple<TColumns, IndexColumns<TTerms>>
              : false
            : false
          : false
        : false
    }[keyof TIndexes]
    ? true
    : false
  : false

type TargetMetadata<
  TTarget extends ForeignKeyTarget,
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord,
> = [SourceIdentity<TTarget['table']>] extends [TableIdentity<TName>]
  ? [TableIdentity<TName>] extends [SourceIdentity<TTarget['table']>]
    ? readonly [TConstraints, TIndexes]
    : readonly [ConstraintsOf<TTarget['table']>, IndexesOf<TTarget['table']>]
  : readonly [ConstraintsOf<TTarget['table']>, IndexesOf<TTarget['table']>]

type InvalidForeignKey<
  TConstraint extends ForeignKeyConstraint,
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord,
> =
  ResolvedTarget<TConstraint['target']> extends infer TTarget
    ? TTarget extends ForeignKeyTarget
      ? Exclude<
          DependenciesOf<TTarget['columns'][number]>,
          ColumnDependency<SourceIdentity<TTarget['table']>, string>
        > extends never
        ? TargetMetadata<
            TTarget,
            TName,
            TConstraints,
            TIndexes
          > extends readonly [infer TTargetConstraints, infer TTargetIndexes]
          ? HasMatchingConstraint<
              TTarget['columns'],
              TTargetConstraints
            > extends true
            ? never
            : HasMatchingIndex<TTarget['columns'], TTargetIndexes> extends true
              ? never
              : TConstraint
          : TConstraint
        : TConstraint
      : TConstraint
    : TConstraint

type InvalidConstraint<
  TConstraint,
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord,
> = TConstraint extends ForeignKeyConstraint
  ? InvalidForeignKey<TConstraint, TName, TConstraints, TIndexes>
  : TConstraint extends CheckConstraint<infer TExpression>
    ? InvalidExpression<TExpression, TName>
    : never

type InvalidConstraints<
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord,
> = TConstraints[keyof TConstraints] extends infer TConstraint
  ? InvalidConstraint<TConstraint, TName, TConstraints, TIndexes>
  : never

type InvalidIndex<TIndex, TName extends string> = TIndex extends {
  readonly terms: infer TTerms extends readonly IndexTerm[]
  readonly predicate: infer TPredicate
}
  ?
      | InvalidExpression<IndexTermExpression<TTerms[number]>, TName>
      | (TPredicate extends AnyExpression
          ? SqlTypeOf<TPredicate> extends SqlBoolean
            ? InvalidExpression<TPredicate, TName>
            : TPredicate
          : never)
      | InvalidIncludedColumns<IndexIncludedColumns<TIndex>, TName>
  : TIndex

type InvalidIndexes<
  TName extends string,
  TIndexes extends SourceIndexesRecord,
> = TIndexes[keyof TIndexes] extends infer TIndex
  ? InvalidIndex<TIndex, TName>
  : never

type ConstraintValidation<
  TName extends string,
  TConstraints extends SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord,
> = [InvalidConstraintDependencies<TName, TConstraints>] extends [never]
  ? [InvalidConstraints<TName, TConstraints, TIndexes>] extends [never]
    ? [InvalidIndexes<TName, TIndexes>] extends [never]
      ? unknown
      : { readonly __invalid_indexes__: InvalidIndexes<TName, TIndexes> }
    : {
        readonly __invalid_constraints__: InvalidConstraints<
          TName,
          TConstraints,
          TIndexes
        >
      }
  : {
      readonly __invalid_constraint_columns__: InvalidConstraintDependencies<
        TName,
        TConstraints
      >
    }

export type TableMetadataCallback<
  TName extends string,
  TDefinitions extends TableDefinitions,
  TConstraints extends SourceConstraintsRecord,
  TIndexes extends SourceIndexesRecord,
> = (
  table: Table<TName, TDefinitions>
) => TableOptions<TConstraints, TIndexes> &
  ConstraintValidation<TName, TConstraints, TIndexes>

export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
>(name: TName, definitions: TDefinitions): Table<TName, TDefinitions>
export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
  const TConstraints extends SourceConstraintsRecord,
  const TIndexes extends SourceIndexesRecord,
>(
  name: TName,
  definitions: TDefinitions,
  metadata: TableMetadataCallback<TName, TDefinitions, TConstraints, TIndexes>
): Table<TName, TDefinitions, TConstraints, TIndexes>
export function table<
  const TName extends string,
  const TDefinitions extends TableDefinitions,
  const TConstraints extends SourceConstraintsRecord = {},
  const TIndexes extends SourceIndexesRecord = {},
>(
  name: TName,
  definitions: TDefinitions,
  metadata?: TableMetadataCallback<TName, TDefinitions, TConstraints, TIndexes>
): Table<TName, TDefinitions, TConstraints, TIndexes> {
  type TIdentity = TableIdentity<TName>
  type TRow = TableRow<TDefinitions>
  type TSqlTypes = TableSqlTypes<TDefinitions>

  const source = createSource<TIdentity, TRow, never, TSqlTypes>(
    'table',
    context => context.render(identifier(name)),
    identifier(name)
  )

  const sqlNames = resolveSqlNames(
    Object.entries(definitions).map(([fieldName, definition]) => ({
      fieldName,
      sqlName: definition.sqlName,
    }))
  )
  const columns = Object.fromEntries(
    Object.keys(definitions).map(fieldName => {
      const sqlName = sqlNames[fieldName]
      return [
        fieldName,
        createColumnReference(
          sqlName,
          source.reference,
          fieldName,
          columnResultValue(definitions[fieldName])
        ) as ColumnReference<string, any>,
      ]
    })
  ) as TableColumns<TDefinitions, TIdentity>

  Object.assign(source, {
    tableName: name,
    definitions,
    sqlNames,
    columns,
    constraints: {},
    indexes: {},
  })

  // Direct column access is convenient; `.columns` remains the escape hatch
  // for a schema containing a reserved property name.
  exposeColumns(source, columns)

  const resolvedMetadata = metadata
    ? metadata(source as Table<TName, TDefinitions>)
    : ({ constraints: {}, indexes: {} } as TableOptions<TConstraints, TIndexes>)
  const constraints = materializeSchemaObjectRecord(
    resolvedMetadata.constraints,
    'constraint'
  ) as TConstraints
  const indexes = Object.fromEntries(
    Object.entries(resolvedMetadata.indexes).map(([indexName, tableIndex]) => {
      const candidateKey =
        tableIndex.unique &&
        tableIndex.predicate === undefined &&
        tableIndex.terms.every((term: IndexTerm) => {
          const expression = 'orderKind' in term ? term.expression : term
          return (
            expression.expressionKind === 'column' &&
            definitions[(expression as ColumnReference).fieldName]?.nullable ===
              false
          )
        })
      return [indexName, Object.freeze({ ...tableIndex, candidateKey })]
    })
  ) as TIndexes
  const namedIndexes = materializeSchemaObjectRecord(
    indexes,
    'index'
  ) as TIndexes
  Object.assign(source, {
    ...resolvedMetadata,
    constraints,
    indexes: namedIndexes,
  })

  return source as Table<TName, TDefinitions, TConstraints, TIndexes>
}
