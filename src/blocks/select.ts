import { assert } from 'radashi'
import { Simplify, UnionToIntersection } from 'type-fest'
import { withAlias } from '../alias.ts'
import {
  boolean,
  empty,
  ident,
  seq,
  sql,
  SQL,
  tokenizePart,
  unsafe,
} from '../core.ts'
import {
  ColumnName,
  IdentName,
  PgSequence,
  SQLAlias,
  SQLDecoder,
  SQLFields,
} from '../core/symbols.ts'
import { $decode, noopDecoder } from '../core/type.ts'

const { formatTableReference } = SQL

type EnforceSingleField<T> = keyof T extends infer K
  ? K extends string
    ? [keyof T] extends [K]
      ? T
      : never
    : never
  : never

export type SelectClausePart = SQL | Record<string, SQL.Part>

export type SelectResult<T extends SelectClausePart> = Simplify<
  UnionToIntersection<
    T extends SQL.Expression<infer TOutput, infer Alias>
      ? string extends Alias
        ? never
        : { [K in Alias]: TOutput }
      : T extends SQL.TableWildcard<infer TOutput>
        ? TOutput
        : T extends SQL.QueryIdentifier<infer TOutput, infer Alias>
          ? string extends Alias
            ? never
            : { [K in Alias]: EnforceSingleField<TOutput>[keyof TOutput] }
          : T extends Record<string, SQL.Part>
            ? PropertyKey extends keyof T
              ? never
              : { -readonly [K in keyof T]: SQL.InferOutput<T[K]> }
            : never
  >
>

export const select = <const T extends SelectClausePart[]>(...parts: T) => {
  const selectQuery = new SQL.Query<SelectResult<T[number]>>('select')

  let fieldMappers: Record<string, SQL.Decoder> | undefined

  const trailingParts: SQL.Part[] = []
  const selectedFields = parts.map(part => {
    if (SQL.isExpression(part)) {
      const fieldName =
        part[SQLAlias]?.[IdentName] ??
        (SQL.isColumnReference(part) ? part[ColumnName] : null)
      assert(
        fieldName != null,
        'Must use .as() to alias SQL expressions in a select clause'
      )
      fieldMappers ||= {}
      fieldMappers[fieldName] = part[SQLDecoder] || noopDecoder
      return part
    }
    if (part instanceof SQL.TableWildcard) {
      Object.assign((fieldMappers ||= {}), part[SQLFields])
      return part
    }
    if (part instanceof SQL.QueryIdentifier) {
      assert(part[SQLFields], 'Query must be SELECT or have a RETURNING clause')
      const fieldNames = Object.keys(part[SQLFields])
      assert(
        fieldNames.length === 1,
        `Query must have exactly one column, got ${fieldNames.length}`
      )
      fieldMappers ||= {}
      fieldMappers[fieldNames[0]] = part[SQLFields][fieldNames[0]]
      return seq([[part], unsafe('as'), part[SQLAlias]])
    }
    if (part instanceof SQL) {
      if (fieldMappers) {
        trailingParts.push(part)
      } else {
        tokenizePart(part, selectQuery[PgSequence])
      }
      return empty // Not a field.
    }
    fieldMappers ||= {}
    return seq(
      // Convert plain object to a sequence of aliased expressions.
      Object.entries(part).map(([alias, value]) =>
        withAlias(value, alias, fieldMappers)
      ),
      ', '
    )
  })

  assert(fieldMappers, 'Must declare at least one field')
  selectQuery[SQLFields] = fieldMappers

  selectQuery.$append([seq(selectedFields, ', '), ...trailingParts])

  return selectQuery

  // .mapWith(rows => {
  //   const keys = Object.keys(fieldMappers)
  //   return (rows as Record<string, unknown>[]).map(row => {
  //     for (const key of keys) {
  //       if (row[key] != null) {
  //         row[key] = fieldMappers[key](row[key])
  //       }
  //     }
  //     // TODO: type inference
  //     return row
  //   })
  // })
}

/**
 * In PostgreSQL, `SELECT DISTINCT` returns only unique rows based on
 * the columns specified in the select clause.
 */
export function selectDistinct<const T extends SelectClausePart[]>(
  ...parts: T
) {
  const query = select(...parts)
  query[PgSequence][0] += ' distinct'
  return query
}

/**
 * Identical to `select(distinctOn(…), …)`
 *
 * Easier to import, but harder to make optional.
 * @example
 * ```ts
 * // These are identical:
 * selectDistinctOn([users.name], users.id, users.name)
 * select(distinctOn(users.name), users.id, users.name)
 * ```
 */
export const selectDistinctOn = <const T extends SelectClausePart[]>(
  columns: (SQL.ColumnReference | string)[],
  ...parts: T
) => select(distinctOn(...columns), ...parts)

/**
 * Use this at the beginning of a select clause to return only unique
 * rows. The benefit of using this over `selectDistinct` is that it's
 * easier to make optional.
 * @example
 * ```ts
 * // These are identical:
 * selectDistinct(users.id, users.name)
 * select(distinct(), users.id, users.name)
 *
 * // Optional distinct:
 * select($if(someCondition, distinct()), users.id, users.name)
 * ```
 */
export const distinct = () => new SQL.Component('distinct')

/**
 * In PostgreSQL, `DISTINCT ON` selects the first row of each set of
 * rows that share the same values in the specified column(s),
 * according to the `ORDER BY` clause.
 *
 * @example
 * ```ts
 * // For each unique name, select all columns from people of the
 * // youngest person with that name.
 * sql(
 *   select(distinctOn(people.name), people),
 *   from(people),
 *   orderBy(people.age.desc())
 * )
 * ```
 */
export function distinctOn(...columns: (SQL.ColumnReference | string)[]) {
  return sql(new SQL.Component('distinct on'), [
    seq(
      columns.map(column =>
        ident(typeof column === 'string' ? column : column[ColumnName])
      ),
      ', '
    ),
  ])
}

/**
 * The `FROM` clause of a SELECT statement.
 */
export function from<T extends [SQL.TableReference, ...SQL.TableReference[]]>(
  ...tables: T
) {
  return new SQL.Component(
    'from',
    $decode<SQL.InferOutput<T[number]>>()
  ).$append([seq(tables.map(formatTableReference), ', ')])
}

const join =
  <JoinType extends string>(type: JoinType) =>
  <T extends SQL.TableReference>(tableRef: T) => ({
    on: (...parts: SQL.Part[]) =>
      new SQL.Component(`${type} join`, $decode<SQL.InferOutput<T>>()).$append([
        formatTableReference(tableRef),
        unsafe('on'),
        ...parts,
      ]),
  })

/**
 * The `INNER JOIN` clause of a SELECT statement.
 */
export const innerJoin = join('inner')
/**
 * The `LEFT JOIN` clause of a SELECT statement.
 */
export const leftJoin = join('left')
/**
 * The `FULL JOIN` clause of a SELECT statement.
 */
export const fullJoin = join('full')

/**
 * The `CROSS JOIN` clause of a SELECT statement.
 */
export const crossJoin = <T extends SQL.TableReference>(tableRef: T) =>
  new SQL.Component('cross join', $decode<SQL.InferOutput<T>>()).$append([
    formatTableReference(tableRef),
  ])

/**
 * The `NATURAL JOIN` clause of a SELECT statement. Identical to
 * `NATURAL INNER JOIN`.
 */
export const naturalJoin = <T extends SQL.TableReference>(tableRef: T) =>
  new SQL.Component('natural join', $decode<SQL.InferOutput<T>>()).$append([
    formatTableReference(tableRef),
  ])

/**
 * The `NATURAL LEFT JOIN` clause of a SELECT statement.
 */
export const naturalLeftJoin = <T extends SQL.TableReference>(tableRef: T) =>
  new SQL.Component('natural left join', $decode<SQL.InferOutput<T>>()).$append(
    [formatTableReference(tableRef)]
  )

/**
 * The `NATURAL RIGHT JOIN` clause of a SELECT statement.
 */
export const naturalRightJoin = <T extends SQL.TableReference>(tableRef: T) =>
  new SQL.Component(
    'natural right join',
    $decode<SQL.InferOutput<T>>()
  ).$append([formatTableReference(tableRef)])

/**
 * The `WHERE` clause of a SELECT statement.
 */
export function where(...parts: SQL.Part[]) {
  return new SQL.Component('where').$append(parts)
}

/**
 * The `EXISTS` predicate.
 */
export function exists(query: SQL.Query) {
  return new SQL.Expression<boolean>(['exists', [query]]).mapWith(boolean)
}

/**
 * The `NOT EXISTS` predicate.
 */
export function notExists(query: SQL.Query) {
  return new SQL.Expression<boolean>(['not exists', [query]]).mapWith(boolean)
}

/**
 * The `ORDER BY` clause of a SELECT statement.
 */
export function orderBy(...parts: SQL.Part[]) {
  return new SQL.Component('order by').$append(parts)
}
