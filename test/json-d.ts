import type { CapabilitiesOf, JsonPath } from '../src/index.ts'
import { jsonPath, render } from '../src/index.ts'
import { createDialect, type Dialect } from '../src/core/index.ts'
import { mysqlDialect } from '../src/dialects/mysql.ts'
import { postgresDialect } from '../src/dialects/postgres.ts'
import { sqliteDialect } from '../src/dialects/sqlite.ts'
import { query } from './json-fixtures.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

const path = jsonPath('users', 0, 'name')
const customJsonDialect = createDialect({
  name: 'custom-json',
  placeholder: () => '?',
  json: {
    renderScalar() {},
    renderExists() {},
  },
})

export type PathPreservesSegments = Assert<
  Equal<typeof path, JsonPath<readonly ['users', 0, 'name']>>
>

export type QueryRequiresJson = Assert<
  Equal<CapabilitiesOf<typeof query>, 'json'>
>

export type PostgresAdvertisesJson = Assert<
  typeof postgresDialect extends () => Dialect<'ilike' | 'json' | 'on-conflict'>
    ? true
    : false
>

export type JsonRendererAdvertisesCapability = Assert<
  Equal<typeof customJsonDialect, Dialect<'json'>>
>

render(query)
render(query, postgresDialect())
render(query, mysqlDialect())
render(query, sqliteDialect())
render(query, customJsonDialect)

// @ts-expect-error Custom dialects need to advertise JSON support.
render(query, createDialect({ name: 'plain', placeholder: () => '?' }))
