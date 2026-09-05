import type { SqlSemanticType } from "qubu/core"
import {
  column,
  nativeStorage,
  type ColumnCodec,
  type ColumnFromOptions,
  type ColumnOptions,
  type NativeColumnStorage,
} from "qubu/schema"

/** A dense pgvector value with a dimension encoded in its TypeScript length when known. */
export type PgVector<TDimensions extends number = number> =
  readonly number[] & { readonly length: TDimensions }

/** The semantic SQL domain carried by a pgvector column. */
export interface SqlPgVector<TDimensions extends number = number>
  extends SqlSemanticType<"postgres.vector"> {
  readonly pgvectorDimensions?: TDimensions
}

export type PgVectorColumnOptions<TDimensions extends number> = Omit<
  ColumnOptions<PgVector<TDimensions>, PgVector<TDimensions>>,
  "castType" | "codec" | "sqlType" | "storage"
>

type VectorStorage<TDimensions extends number> = NativeColumnStorage<
  "postgresql",
  `vector(${TDimensions})`
>

export type PgVectorColumn<
  TDimensions extends number,
  TOptions extends PgVectorColumnOptions<TDimensions> = {},
> = ColumnFromOptions<
  PgVector<TDimensions>,
  PgVector<TDimensions>,
  PgVector<TDimensions>,
  TOptions & { readonly storage: VectorStorage<TDimensions> },
  SqlPgVector<TDimensions>
>

/** Convert a dense vector to pgvector's text input format. */
export function toSql(value: readonly number[], dimensions?: number): string {
  validateVector(value, dimensions)
  return `[${value.join(",")}]`
}

/** Parse pgvector text output or accept an already-decoded numeric array. */
export function fromSql(value: unknown, dimensions?: number): PgVector {
  if (Array.isArray(value)) {
    validateVector(value, dimensions)
    return value.slice() as PgVector
  }

  if (typeof value !== "string") {
    throw new TypeError("pgvector values must be arrays or strings")
  }

  const text = value.trim()

  if (text.length < 2 || text[0] !== "[" || text[text.length - 1] !== "]") {
    throw new TypeError(`Invalid pgvector value ${JSON.stringify(value)}`)
  }

  const body = text.slice(1, -1).trim()
  const parts = body === "" ? [] : body.split(",").map((part) => part.trim())

  if (parts.some((part) => part.length === 0)) {
    throw new TypeError(`Invalid pgvector value ${JSON.stringify(value)}`)
  }

  const result = parts.map((part) => Number(part))

  validateVector(result, dimensions)
  return result as PgVector
}

/** Declare a PostgreSQL `vector(n)` column with a live application/driver codec. */
export function vector<
  const TDimensions extends number,
  const TOptions extends PgVectorColumnOptions<TDimensions> = {},
>(
  dimensions: TDimensions,
  options?: TOptions,
): PgVectorColumn<TDimensions, TOptions> {
  validateDimensions(dimensions)

  const codec: ColumnCodec<PgVector<TDimensions>, PgVector<TDimensions>, unknown> = {
    toDriver(value) {
      return toSql(value, dimensions)
    },
    fromDriver(value) {
      return fromSql(value, dimensions) as PgVector<TDimensions>
    },
  }

  return column({
    ...options,
    sqlType: "postgres.vector",
    storage: nativeStorage("postgresql", `vector(${dimensions})`),
    codec,
  }) as PgVectorColumn<TDimensions, TOptions>
}

function validateDimensions(dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new TypeError("pgvector dimensions must be a positive integer")
  }
}

function validateVector(value: readonly number[], dimensions?: number): void {
  if (!Array.isArray(value)) {
    throw new TypeError("pgvector values must be arrays")
  }

  if (dimensions !== undefined) {
    validateDimensions(dimensions)
    if (value.length !== dimensions) {
      throw new TypeError(
        `pgvector value has ${value.length} dimensions; expected ${dimensions}`,
      )
    }
  }

  if (!value.every((component) => typeof component === "number" && Number.isFinite(component))) {
    throw new TypeError("pgvector components must be finite numbers")
  }
}
