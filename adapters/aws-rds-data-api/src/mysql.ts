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

/** The AWS RDS Data API adapter specialized for Aurora MySQL. */
export type RdsDataApiAdapter = RdsDataApiAdapterFor<"mysql">

/** Create an Aurora MySQL adapter backed by the AWS RDS Data API. */
export function rdsDataApiAdapter(
  client: RdsDataApiClient,
  options: RdsDataApiAdapterOptions,
): RdsDataApiAdapter {
  return createRdsDataApiAdapter(client, "mysql", options)
}

/** Alias matching the full package name. */
export const awsRdsDataApiAdapter = rdsDataApiAdapter

/** Create the AWS named-placeholder MySQL dialect (`:p1`, `:p2`, ...). */
export function rdsDataApiDialect(): Dialect {
  return createRdsDataApiDialect("mysql")
}

/** Alias for the Aurora MySQL dialect. */
export const auroraMysqlDialect = rdsDataApiDialect

/** Alias for the RDS Data API MySQL dialect. */
export const rdsDataApiMysqlDialect = rdsDataApiDialect

export { decodeRdsDataApiField, encodeRdsDataApiParameter, encodeRdsDataApiValue } from "./index.ts"
