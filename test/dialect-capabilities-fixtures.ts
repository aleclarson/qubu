import {
  from,
  like,
  alias,
  select,
  table,
  text,
  unionAll,
  where,
} from '../src/index.ts'
import { createDialect } from '../src/core/index.ts'
import { ilike } from '../src/dialects/postgres.ts'

export const users = table('users', { name: text() })

export const postgresOnlyQuery = select(
  { name: users.name },
  from(users),
  where(ilike(users.name, '%ada%'))
)

export const portableQuery = select(
  { name: users.name },
  from(users),
  where(like(users.name, '%ada%'))
)

export const unionedQuery = unionAll(postgresOnlyQuery, portableQuery)

export const aliasedPostgresQuery = alias(postgresOnlyQuery, 'pg_users')

export const queryFromCapabilityAlias = select(
  { name: aliasedPostgresQuery.name },
  from(aliasedPostgresQuery)
)

export const namedPostgresDialect = createDialect({
  name: 'named-postgresql',
  placeholder: position => `:p${position}`,
  capabilities: ['ilike'],
})
