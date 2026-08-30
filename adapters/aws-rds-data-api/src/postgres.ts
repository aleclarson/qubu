import type { Dialect } from "qubu"

import {
  createRdsDataApiAdapter,
  createRdsDataApiDialect,
  type RdsDataApiAdapter as RdsDataApiAdapterFor,
  type RdsDataApiAdapterOptions,
  type RdsDataApiClient,
} from "./index.ts"

export type {
  RdsDataApiAdapterOptions,
  RdsDataApiClient,
  RdsDataApiCommand,
  RdsDataApiResponse,
  RdsDataApiSendOptions,
  RdsDataApiTransactionAdapter,
} from "./index.ts"

/** The AWS RDS Data API adapter specialized for Aurora PostgreSQL. */
export type RdsDataApiAdapter = RdsDataApiAdapterFor<"postgresql">

/** Create an Aurora PostgreSQL adapter backed by the AWS RDS Data API. */
export function rdsDataApiAdapter(
  client: RdsDataApiClient,
  options: RdsDataApiAdapterOptions,
): RdsDataApiAdapter {
  return createRdsDataApiAdapter(client, "postgresql", options)
}

/** Alias matching the full package name. */
export const awsRdsDataApiAdapter = rdsDataApiAdapter

/** Create the AWS named-placeholder PostgreSQL dialect (`:p1`, `:p2`, ...). */
export function rdsDataApiDialect(): Dialect {
  return createRdsDataApiDialect("postgresql")
}

/** Alias for the Aurora PostgreSQL dialect. */
export const auroraPostgresDialect = rdsDataApiDialect

/** Alias for the RDS Data API PostgreSQL dialect. */
export const rdsDataApiPostgresDialect = rdsDataApiDialect

export { decodeRdsDataApiField, encodeRdsDataApiParameter, encodeRdsDataApiValue } from "./index.ts"
