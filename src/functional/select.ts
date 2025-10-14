import { assert } from 'radashi'
import { InferSQL, SQL } from '../core.ts'
import {
  ColumnType,
  IdentColumn,
  IdentName,
  PgClause,
  PgIdent,
  SQLAlias,
  SQLDecoder,
  SQLFields,
  SQLTokens,
} from '../symbols.ts'
import {
  clause,
  comma,
  empty,
  ident,
  isToken,
  sequence,
  unsafe,
  withAlias,
} from '../tokens.ts'

export type SelectClausePart =
  | SQL
  | SQL.Clause
  | SQL.Identifier
  | Record<string, SQL.Part>

export const select = <const T extends SelectClausePart[]>(...parts: T) => {
  const statement = InferSQL(unsafe('select'))

  const fieldMappers: Record<string, SQL.Decoder> = {}
  statement[SQLFields] = fieldMappers

  const selectedFields = parts.map(part => {
    if (isToken(part, PgClause)) {
      statement.$append(part)
      return empty // Not a field.
    }
    if (isToken(part, PgIdent)) {
      if (part[IdentColumn]) {
        fieldMappers[part[IdentName]] = part[IdentColumn][ColumnType].decode
      }
      return part
    }
    if (part instanceof SQL) {
      assert(
        part[SQLAlias] !== null,
        'Must use .as() to alias SQL in a select clause'
      )
      if (part[SQLDecoder]) {
        fieldMappers[part[SQLAlias]] = part[SQLDecoder]
      }
      return part
    }
    return sequence(
      Object.entries(part).map(([alias, value]) =>
        withAlias(value, alias, fieldMappers)
      ),
      comma
    )
  })

  statement.$append(sequence(selectedFields, comma))

  return statement.mapWith(rows => {
    const keys = Object.keys(fieldMappers)
    return (rows as Record<string, unknown>[]).map(row => {
      for (const key of keys) {
        if (row[key] != null) {
          row[key] = fieldMappers[key](row[key])
        }
      }
      // TODO: type inference
      return row
    })
  })
}

/**
 * In PostgreSQL, `SELECT DISTINCT` returns only unique rows based on
 * the columns specified in the select clause.
 */
export function selectDistinct<const T extends SelectClausePart[]>(
  ...parts: T
) {
  const query = select(...parts)
  query[SQLTokens][0] += ' distinct'
  return query
}

/**
 * Identical to `select(distinctOn(…), …)` but harder to make optional.
 * @example
 * ```ts
 * // These are identical:
 * selectDistinctOn([users.name], users.id, users.name)
 * select(distinctOn(users.name), users.id, users.name)
 * ```
 */
export const selectDistinctOn = <const T extends SelectClausePart[]>(
  columns: (SQL.Identifier | string)[],
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
export const distinct = () => clause('distinct')

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
export function distinctOn(...columns: (SQL.Identifier | string)[]) {
  return clause('distinct on', [
    sequence(
      columns.map(column =>
        typeof column === 'string' ? ident(column) : column
      ),
      comma
    ),
  ])
}

export const from = (tableRef: SQL.Part) => clause('from', tableRef)

const join = (type: string) => (tableRef: SQL.Part) => ({
  on: (...parts: SQL.Part[]) =>
    clause(`${type} join`, tableRef, unsafe('on'), ...parts),
})

export const innerJoin = join('inner')
export const leftJoin = join('left')
export const fullJoin = join('full')
export const crossJoin = join('cross')
export const naturalJoin = join('natural')

export const where = InferSQL.bind(null, unsafe('where'))
export const orderBy = InferSQL.bind(null, unsafe('order by'))
