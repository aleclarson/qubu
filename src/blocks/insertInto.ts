import { $decode, sql, SQL, Table, unsafe } from '../core.ts'

export type InsertIntoParts = [Table | SQL.TableIdentifier, ...SQL[]]

export function insertInto<const T extends InsertIntoParts>(...parts: T) {
  const query = new SQL.Query('insert into').$append(parts)
  return query
}

export function into<T extends Table | SQL.TableIdentifier>(table: T) {
  return new SQL.Component('into', $decode<T>())
}

const isArray = Array.isArray as <T>(
  value: T | readonly T[]
) => value is readonly T[]

export function values<T extends object>(data: T | readonly T[]) {
  return sql(new SQL.Component('values', $decode<T>())).$append(
    isArray(data) ? data.map(row => sql(row)) : [sql(data)]
  )
}

export function defaultValues() {
  return new SQL.Component('default values')
}

export function onConflict(target: any) {
  return {
    doNothing() {},
    doUpdateSet() {},
  }
}

export function onConflictOnConstraint(constraint: string) {
  return {
    doNothing() {},
    doUpdateSet() {},
  }
}

export function overridingSystemValue() {
  return unsafe('overriding system value')
}

export function overridingUserValue() {
  return unsafe('overriding user value')
}

// insertInto(
//   users,
//   overridingSystemValue(),
//   values({
//     name: 'John Doe',
//     email: 'john.doe@example.com',
//   })
// )
