import { expectTypeOf } from 'vitest'
import {
  all,
  gt,
  insertInto,
  integer,
  render,
  returning,
  table,
  text,
  unique,
  values,
  where,
} from '../src/index.ts'
import {
  doNothing,
  doUpdate,
  excluded,
  onConflict,
  postgresDialect,
} from '../src/dialects/postgres.ts'
import { sqliteDialect } from '../src/dialects/sqlite.ts'
import { mysqlDialect } from '../src/dialects/mysql.ts'

const accounts = table(
  'accounts',
  {
    id: integer({ generated: true }),
    email: text(),
    name: text(),
    version: integer(),
  },
  accounts => ({
    constraints: {
      emailKey: unique(accounts.email),
    },
    indexes: {},
  })
)
const other = table('other', { name: text() })

const incoming = excluded(accounts)
const query = insertInto(
  accounts,
  values({ email: 'ada@example.com', name: 'Ada', version: 2 }),
  onConflict(
    accounts,
    accounts.constraints.emailKey,
    doUpdate(
      { name: incoming.name },
      where(gt(incoming.version, accounts.version))
    )
  ),
  returning(all(accounts))
)

expectTypeOf(query.row).toEqualTypeOf<{
  id: number
  email: string
  name: string
  version: number
}>()

render(query, postgresDialect())
render(query, sqliteDialect())

// @ts-expect-error ON CONFLICT is not advertised by MySQL.
render(query, mysqlDialect())

insertInto(
  accounts,
  values({ email: 'ada@example.com', name: 'Ada', version: 1 }),
  onConflict(doNothing())
)

onConflict(
  accounts,
  accounts.constraints.emailKey,
  // @ts-expect-error DO UPDATE expressions cannot reference an unrelated source.
  doUpdate({ name: excluded(other).name })
)

// @ts-expect-error DO UPDATE needs a target table and conflict target.
onConflict(doUpdate({ name: incoming.name }))
