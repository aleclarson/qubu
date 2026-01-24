import { isArray } from 'radashi'
import { $decode, sql, SQL, Table, unsafe } from '../core.ts'

export type InsertIntoPart = SQL | Record<string, SQL.Part>

export function insert(
  ,
  ...parts: InsertIntoPart[]
) {}

export function into<T extends Table | SQL.TableIdentifier>(table: T) {
  return new SQL.Component('into', $decode<Table | SQL.TableIdentifier>())
}

// insert one row with all columns specified
insert(
  into(users).values({…})
)

// insert multiple rows with subset of columns specified
insert(
  into(users, ['id', 'name']).values([{…}, {…}])
)

insert(
  into(users).overridingSystemValue().values({…})
)

const isArray = Array.isArray as <T>(
  value: T | readonly T[]
) => value is readonly T[]

export function values<T extends object>(data: T | readonly T[]) {
  return sql(new SQL.Component('values', $decode<T>())).$append(
    isArray(data) ? data.map(row => sql(row)) : [sql(data)]
  )
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

insertInto(
  users,
  overridingSystemValue(),
  values({
    name: 'John Doe',
    email: 'john.doe@example.com',
  })
)
