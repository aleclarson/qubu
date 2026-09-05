import { dialect } from "./dialect.ts"
import { index } from "./indexes.ts"
import {
  cosineDistance,
  l1Distance,
  l2Distance,
  negativeInnerProduct,
  pgvectorCapability,
} from "./query.ts"
import { fromSql, toSql, vector } from "./vector.ts"

/** Namespace-first public API for PostgreSQL pgvector support. */
export const pgvector = Object.freeze({
  capability: pgvectorCapability,
  dialect,
  vector,
  index,
  toSql,
  fromSql,
  l2Distance,
  negativeInnerProduct,
  cosineDistance,
  l1Distance,
})

export { dialect }
export { index }
export type {
  PgVectorIndexDistance,
  PgVectorIndexExtension,
  PgVectorIndexMethod,
  PgVectorIndexOptions,
} from "./indexes.ts"
export {
  cosineDistance,
  l1Distance,
  l2Distance,
  negativeInnerProduct,
  pgvectorCapability,
} from "./query.ts"
export type { PgVectorDistanceExpression } from "./query.ts"
export {
  fromSql,
  toSql,
  vector,
} from "./vector.ts"
export type {
  PgVector,
  PgVectorColumn,
  PgVectorColumnOptions,
  SqlPgVector,
} from "./vector.ts"
