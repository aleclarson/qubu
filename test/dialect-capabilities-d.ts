import type {
  CapabilitiesOf,
  Dialect,
  DialectCapability,
  MetadataOf,
  RequiresCapabilityMeta,
} from '../src/index.ts'
import { render } from '../src/index.ts'
import { createDialect } from '../src/core/index.ts'
import { postgresDialect } from '../src/dialects/postgres.ts'
import { sqliteDialect } from '../src/dialects/sqlite.ts'
import {
  namedPostgresDialect,
  queryFromCapabilityAlias,
  portableQuery,
  postgresOnlyQuery,
  unionedQuery,
} from './dialect-capabilities-fixtures.ts'

type Equal<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : false
  : false

type Assert<TCondition extends true> = TCondition

export type CapabilityVocabulary = Assert<
  Equal<DialectCapability, 'ilike' | 'json' | 'on-conflict' | 'row-locking'>
>

export type PostgresQueryRequiresIlike = Assert<
  Equal<CapabilitiesOf<typeof postgresOnlyQuery>, 'ilike'>
>

export type SetCompositionPreservesCapabilities = Assert<
  Equal<CapabilitiesOf<typeof unionedQuery>, 'ilike'>
>

export type SourceAliasPreservesCapabilities = Assert<
  Equal<CapabilitiesOf<typeof queryFromCapabilityAlias>, 'ilike'>
>

export type CapabilityMetadataIsTagged = Assert<
  Equal<
    Extract<
      MetadataOf<typeof postgresOnlyQuery>,
      { readonly kind: 'requires-capability' }
    >,
    RequiresCapabilityMeta<'ilike'>
  >
>

export type PostgresDialectAdvertisesIlike = Assert<
  typeof postgresDialect extends () => Dialect<
    'ilike' | 'json' | 'on-conflict' | 'row-locking'
  >
    ? true
    : false
>

export type NamedDialectAdvertisesIlike = Assert<
  Equal<typeof namedPostgresDialect, Dialect<'ilike'>>
>

render(postgresOnlyQuery, postgresDialect())
render(postgresOnlyQuery, namedPostgresDialect)
render(unionedQuery, postgresDialect())
render(queryFromCapabilityAlias, postgresDialect())
render(portableQuery)
render(portableQuery, sqliteDialect())

// @ts-expect-error The default standard dialect does not support PostgreSQL ILIKE.
render(postgresOnlyQuery)

// @ts-expect-error SQLite does not advertise the ILIKE capability.
render(postgresOnlyQuery, sqliteDialect())

// @ts-expect-error Set operations cannot hide a capability requirement.
render(unionedQuery, sqliteDialect())

// @ts-expect-error Source aliases cannot hide a capability requirement.
render(queryFromCapabilityAlias, sqliteDialect())

render(
  // @ts-expect-error A custom dialect must advertise ILIKE before it can render it.
  postgresOnlyQuery,
  createDialect({ name: 'portable-only', placeholder: () => '?' })
)
