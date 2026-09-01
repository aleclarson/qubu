import type { AnyTable, TableRow } from "qubu"
import {
  defineAccount as defineValtioSyncAccount,
  defineCollection as defineValtioSyncCollection,
  type AccountDefinition,
  type CollectionDefinition,
  type FieldSchema,
  type RecordRefinement,
} from "valtio-sync/schema"
import { z } from "zod"

const qubuTypeMarker: unique symbol = Symbol("qubu.valtio-sync.type")
const serverOnlyMarker: unique symbol = Symbol("qubu.valtio-sync.server-only")

/** Compile-time marker tying a Valtio Sync definition to a Qubu table type. */
export type QubuType<TTable extends AnyTable> = {
  readonly [qubuTypeMarker]: TTable
}

/** Branded sentinel for a Qubu table field that is excluded from synced records. */
export type ServerOnly = z.ZodNever & {
  readonly [serverOnlyMarker]: true
}

type QubuField = FieldSchema | ServerOnly
type QubuFieldMap = Record<string, QubuField>
type SyncedFields<TFields extends QubuFieldMap> = {
  [K in keyof TFields as TFields[K] extends ServerOnly ? never : K]: Exclude<TFields[K], ServerOnly>
}

type QubuCompatibleFields<
  TRow extends Record<string, unknown>,
  TFields extends QubuFieldMap,
> = TFields & { [K in Exclude<keyof TFields, keyof TRow>]: never } & {
  [K in Exclude<keyof TRow, keyof TFields>]-?: QubuField
} & {
  [K in keyof TFields & keyof TRow]: TFields[K] extends ServerOnly
    ? TFields[K]
    : TFields[K] extends FieldSchema
      ? z.output<TFields[K]> extends TRow[K]
        ? TFields[K]
        : never
      : never
}

/** Options for defining a Valtio Sync entry whose fields must match a Qubu table row. */
export type QubuDefinitionOptions<TTable extends AnyTable, TFields extends QubuFieldMap> = {
  readonly dbType: QubuType<TTable>
  readonly fields: QubuCompatibleFields<TableRow<TTable["definitions"]>, TFields>
  readonly refine?: RecordRefinement<SyncedFields<TFields>>
}

/** Capture a Qubu table type for compile-time field compatibility checks. */
export function $type<TTable extends AnyTable>(): QubuType<TTable> {
  return {} as QubuType<TTable>
}

/** Mark a Qubu table field as persistence-only and exclude it from sync. */
export function serverOnly(): ServerOnly {
  const sentinel = z.never() as ServerOnly

  Object.defineProperty(sentinel, serverOnlyMarker, { value: true })
  return sentinel
}

/** Define singleton account state whose fields are checked against a Qubu table row. */
export function defineAccount<TTable extends AnyTable, const TFields extends QubuFieldMap>(
  options: QubuDefinitionOptions<TTable, TFields>,
): AccountDefinition<SyncedFields<TFields>> {
  return defineValtioSyncAccount({
    fields: syncedFields(options.fields),
    refine: options.refine,
  })
}

/** Define a collection whose fields are checked against a Qubu table row. */
export function defineCollection<TTable extends AnyTable, const TFields extends QubuFieldMap>(
  options: QubuDefinitionOptions<TTable, TFields>,
): CollectionDefinition<SyncedFields<TFields>> {
  return defineValtioSyncCollection({
    fields: syncedFields(options.fields),
    refine: options.refine,
  })
}

function syncedFields<TFields extends QubuFieldMap>(
  fields: QubuCompatibleFields<Record<string, unknown>, TFields> | TFields,
): SyncedFields<TFields> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, field]) => !isServerOnly(field)),
  ) as SyncedFields<TFields>
}

function isServerOnly(field: QubuField): field is ServerOnly {
  return serverOnlyMarker in field
}
