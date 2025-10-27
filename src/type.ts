import { SQL } from './core.ts'
import { Column } from './definition/column.ts'
import { PgType } from './symbols.ts'

const inOut = (arg: any) => arg

/**
 * Shortcut for encoding and decoding functions that don't do any
 * processing. Exists for type safety at compile time.
 */
export const $encode = <T>() => inOut as (value: T) => T

/**
 * Shortcut for decoding functions that don't do any processing.
 * Exists for type safety at compile time.
 */
export const $decode = <T>() => inOut as (value: unknown) => T

/**
 * Declare a database type, with serialization and parsing functions.
 */
export function pgType<
  Id extends string,
  In,
  Out,
  DefaultNullable extends boolean = true,
>(
  id: Id,
  encode: (jsType: In) => any,
  decode: (sqlType: any) => Out,
  nullable = true as DefaultNullable
) {
  function type(name = '') {
    return new Column(name, type, nullable)
  }
  type[PgType] = id
  type.encode = encode
  type.decode = decode
  return type
}

/**
 * Declare an array variant of a given data type.
 */
export function array<Id extends string, In, Out>(
  itemType: SQL.Type<Id, In, Out>
): SQL.Type<`${Id}[]`, In[], Out[]> {
  return pgType(
    `${itemType[PgType]}[]`,
    (data: In[]) =>
      data.map(item => {
        return item == null ? null : itemType.encode(item)
      }),
    (data: any[]) => data.map(itemType.decode)
  )
}
