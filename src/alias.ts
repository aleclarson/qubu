import { assert } from 'radashi'
import { sql, SQL } from './core.ts'
import { ColumnName, IdentName, SQLAlias, SQLDecoder } from './core/symbols.ts'
import { noopDecoder } from './core/type.ts'

/**
 * Alias a SQL part. If the alias already matches the part's identity
 * (e.g. column name or pre-existing alias), the part is returned as
 * is.
 *
 * Optionally, pass a `fields` object and any decoder associated with
 * the part will be added.
 */
export function withAlias(
  part: SQL.Part,
  alias: string,
  fields?: Record<string, SQL.Decoder>
) {
  if (part instanceof SQL) {
    let name: string | undefined
    let decoder: SQL.Decoder | null | undefined
    if (SQL.isExpression(part)) {
      name = part[SQLAlias]?.[IdentName]
      decoder = part[SQLDecoder]
    } else if (SQL.isColumnReference(part)) {
      name = part[ColumnName]
      decoder = part[SQLDecoder]
    }
    if (fields) {
      assert(fields[alias] == null, `Alias appears twice: ${alias}`)
      fields[alias] = decoder || noopDecoder
    }
    if (name && alias === name) {
      return part
    }
  }
  return sql(part).as(alias)
}
