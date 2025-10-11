import { SQL, sql } from '../core.ts'
import { SQLFields, SQLTokens } from '../symbols.ts'
import { clause, comma, ident, sequence, unsafe, withAlias } from '../tokens.ts'
import { isPlainObject } from '../util.ts'

export const select = <T extends (SQL.Part | Record<string, SQL.Part>)[]>(
  ...args: T
) => {
  const fields: Record<string, SQL.Decoder> = {}
  const selected = args.map(arg => {
    if (isPlainObject<SQL.Part>(arg)) {
      return sequence(
        Object.entries(arg).map(([alias, value]) =>
          withAlias(value, alias, fields)
        ),
        comma
      )
    }
    if (arg instanceof SQL) {
    }
    // TODO: extract decoders
    return arg
  })

  const query = sql(unsafe('select'), sequence(selected, comma)).mapWith(
    rows => {
      const keys = Object.keys(fields)
      return (rows as Record<string, unknown>[]).map(row => {
        for (const key of keys) {
          if (row[key] != null) {
            row[key] = fields[key](row[key])
          }
        }
        return row
      })
    }
  )

  query[SQLFields] = fields
  return query
}

/**
 * In PostgreSQL, `SELECT DISTINCT` returns only unique rows based on
 * the columns specified in the select clause.
 */
export function selectDistinct<
  T extends (SQL.Part | Record<string, SQL.Part>)[],
>(...args: T) {
  const query = select(...args)
  query[SQLTokens].splice(1, 0, 'distinct')
  return query
}

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

export const where = sql.bind(null, unsafe('where'))
export const orderBy = sql.bind(null, unsafe('order by'))
