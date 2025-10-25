import { assert } from 'radashi'
import { sql, SQL } from '../core.ts'
import {
  ColumnType,
  IdentColumn,
  IdentName,
  PgIdent,
  PgSequence,
  SQLAlias,
  SQLDecoder,
  SQLFields,
} from '../symbols.ts'
import {
  comma,
  empty,
  ident,
  isToken,
  seq,
  Token,
  unsafe,
  withAlias,
} from '../tokens.ts'

export type SelectClausePart = SQL | Token.Identifier | Record<string, SQL.Part>

export const select = <const T extends SelectClausePart[]>(...parts: T) => {
  const selectQuery = new SQL.Query('select')

  const fieldMappers: Record<string, SQL.Decoder> = {}
  selectQuery[SQLFields] = fieldMappers

  const selectedFields = parts.map(part => {
    if (isToken(part, PgIdent)) {
      if (part[IdentColumn]) {
        fieldMappers[part[IdentName]] = part[IdentColumn][ColumnType].decode
      }
      return part
    }
    if (SQL.isExpression(part)) {
      assert(
        part[SQLAlias] !== null,
        'Must use .as() to alias SQL expressions in a select clause'
      )
      if (part[SQLDecoder]) {
        fieldMappers[part[SQLAlias][IdentName]] = part[SQLDecoder]
      }
      return part
    }
    if (part instanceof SQL) {
      selectQuery.$append(part)
      return empty // Not a field.
    }
    // Convert plain object to a sequence of aliased expressions.
    return seq(
      Object.entries(part).map(([alias, value]) =>
        withAlias(value, alias, fieldMappers)
      ),
      comma
    )
  })

  selectQuery.$append(seq(selectedFields, comma))

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
  columns: (Token.Identifier | string)[],
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
export function distinctOn(...columns: (Token.Identifier | string)[]) {
  return sql(new SQL.Component('distinct on'), [
    seq(
      columns.map(column =>
        typeof column === 'string' ? ident(column) : column
      ),
      comma
    ),
  ])
}

/**
 * The `FROM` clause of a SELECT statement.
 */
export const from = (
  ...tables: [SQL.TableReference, ...SQL.TableReference[]]
) => sql(new SQL.Component('from'), seq(tables, comma))

const join = (type: string) => (tableRef: SQL.TableReference) => ({
  on: (...parts: SQL.Part[]) =>
    sql(new SQL.Component(`${type} join`), tableRef, unsafe('on'), ...parts),
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
export const crossJoin = join('cross')
/**
 * The `NATURAL JOIN` clause of a SELECT statement.
 */
export const naturalJoin = join('natural')

/**
 * The `WHERE` clause of a SELECT statement.
 */
export const where = (...parts: SQL.Part[]) =>
  sql(new SQL.Component('where'), ...parts)

/**
 * The `ORDER BY` clause of a SELECT statement.
 */
export const orderBy = (...parts: SQL.Part[]) =>
  sql(new SQL.Component('order by'), ...parts)
