import type { IndexDialectExtension } from "qubu/schema"
import type { ColumnReference } from "qubu"
import type { SchemaDialectExtension } from "qubu/schema"

export type PgVectorIndexDistance = "l2" | "ip" | "cosine" | "l1"
export type PgVectorIndexMethod = "hnsw" | "ivfflat"

/** PostgreSQL index metadata used by pgvector's approximate access methods. */
export interface PgVectorIndexExtension extends SchemaDialectExtension<"postgresql"> {
  readonly [key: string]: unknown
  readonly dialect: "postgresql"
  readonly method: PgVectorIndexMethod
  readonly concurrently?: boolean
  readonly storageParameters?: Readonly<Record<string, string | number | boolean>>
}

export interface PgVectorIndexOptions {
  readonly distance?: PgVectorIndexDistance
  readonly method?: PgVectorIndexMethod
  readonly concurrently?: boolean
  readonly storageParameters?: Readonly<Record<string, string | number | boolean>>
  readonly physicalName?: string
}

type PgVectorIndexMetadata<TColumn extends ColumnReference<string, any>> = {
  readonly kind: "index"
  readonly terms: readonly [TColumn]
  readonly unique: false
  readonly predicate: undefined
  readonly termOptions: readonly [{ readonly operatorClass: string }]
  readonly dialect: PgVectorIndexExtension
  readonly candidateKey: false
  readonly physicalName?: string
}

/** Declare an HNSW or IVFFlat index with the matching pgvector operator class. */
export function index<TColumn extends ColumnReference<string, any>>(
  column: TColumn,
  options: PgVectorIndexOptions = {},
): PgVectorIndexMetadata<TColumn> {
  const distance = options.distance ?? "l2"
  const method = options.method ?? "hnsw"
  const extension = {
    dialect: "postgresql" as const,
    method,
    ...(options.concurrently === undefined ? {} : { concurrently: options.concurrently }),
    ...(options.storageParameters === undefined
      ? {}
      : { storageParameters: Object.freeze({ ...options.storageParameters }) }),
  } as PgVectorIndexExtension & IndexDialectExtension

  return Object.freeze({
    kind: "index" as const,
    terms: Object.freeze([column]),
    unique: false,
    predicate: undefined,
    termOptions: Object.freeze([
      Object.freeze({
        operatorClass: `vector_${distance}_ops`,
      }),
    ]),
    dialect: Object.freeze(extension),
    candidateKey: false,
    ...(options.physicalName === undefined ? {} : { physicalName: options.physicalName }),
  }) as PgVectorIndexMetadata<TColumn>
}
