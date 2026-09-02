import type { BetterAuthDBSchema, DBFieldAttribute } from "better-auth/db"
import { getAuthTables } from "better-auth/db"
import type { BetterAuthOptions } from "better-auth/types"
import {
  boolean,
  booleanResultDecoder,
  column as defineColumn,
  externalDefault,
  foreignKey,
  index,
  identityColumn,
  integer,
  json,
  jsonTextResultDecoder,
  nativeColumn,
  nativeStorage,
  primaryKey,
  portableStorage,
  schema,
  table,
  text,
  timestamp,
  timestampResultDecoder,
  unique,
  uniqueConstraint,
  uuid,
  references,
  type AnyTable,
  type ColumnDefinition,
  type Schema,
  type Table,
} from "qubu"
import { defineSchemaExpression, generatedSchemaObjectName } from "qubu/schema"

const postgresUuidDefault = defineSchemaExpression("function", (context) => {
  context.append("pg_catalog.gen_random_uuid()")
})
const currentTimestampDefault = defineSchemaExpression("function", (context) => {
  context.append("CURRENT_TIMESTAMP")
})
const mysqlCurrentTimestampDefault = defineSchemaExpression("function", (context) => {
  context.append("CURRENT_TIMESTAMP(3)")
})

/*
 * Qubu emits full-column indexes and foreign keys, so MySQL TEXT is not viable
 * for key columns. IDs/FKs use the same bounded declaration; other indexed
 * strings use VARCHAR(255), and DATETIME(3) matches CURRENT_TIMESTAMP(3).
 */
const mysqlIdStorage = "VARCHAR(36)"
const mysqlKeyStorage = "VARCHAR(255)"
const mysqlTimestampStorage = "DATETIME(3)"

type BetterAuthTableMetadata = BetterAuthDBSchema[string]
type BetterAuthTableEntry = readonly [string, BetterAuthTableMetadata]
type BetterAuthTableMap = Record<string, AnyTable>
type BetterAuthReference = NonNullable<DBFieldAttribute["references"]>

/** SQL dialects whose Better Auth behavior is implemented by this package. */
export type BetterAuthDialect = "postgresql" | "mysql" | "sqlite"

/** One actionable, path-addressed schema conversion failure. */
export interface BetterAuthSchemaDiagnostic {
  readonly code:
    | "unsupported-field-type"
    | "unknown-index-field"
    | "duplicate-sql-name"
    | "invalid-reference"
  readonly message: string
  readonly path: readonly string[]
}

/** Raised when Better Auth metadata cannot be represented losslessly by Qubu. */
export class BetterAuthSchemaError extends TypeError {
  readonly name = "BetterAuthSchemaError"
  readonly diagnostics: readonly BetterAuthSchemaDiagnostic[]
  readonly issues: readonly BetterAuthSchemaDiagnostic[]

  constructor(diagnostics: readonly BetterAuthSchemaDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
    this.diagnostics = Object.freeze([...diagnostics])
    this.issues = this.diagnostics
  }
}

/** A Qubu schema retaining its resolved Better Auth ownership metadata. */
export interface BetterAuthQubuSchema extends Schema {
  /** Better Auth schema metadata, including plugin-contributed tables. */
  readonly betterAuth: BetterAuthDBSchema
  /** Resolve a Better Auth model name to its Qubu table. */
  readonly tableFor: (model: string) => Table
}

/** Qubu-specific derivation inputs that cannot be recovered from resolved Better Auth metadata. */
export interface BetterAuthSchemaOptions {
  /** Better Auth's configured database id generation strategy. */
  readonly generateId?: "serial" | "uuid"
  /** Explicit Better Auth physical field-name overrides, keyed by logical model and field. */
  readonly fieldNames?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Derive Qubu tables from Better Auth's resolved public database metadata. */
export function betterAuthSchema(
  options: BetterAuthOptions,
  dialect: BetterAuthDialect,
): BetterAuthQubuSchema {
  return betterAuthSchemaFromTables(getAuthTables(options), dialect, resolveSchemaOptions(options))
}

/** Derive Qubu tables from already-resolved Better Auth database metadata. */
export function betterAuthSchemaFromTables(
  authTables: BetterAuthDBSchema,
  dialect: BetterAuthDialect,
  options: BetterAuthSchemaOptions = {},
): BetterAuthQubuSchema {
  const diagnostics: BetterAuthSchemaDiagnostic[] = []
  const entries = Object.entries(authTables) as BetterAuthTableEntry[]
  const keyFields = collectKeyFields(authTables)
  const definitions = new Map<string, Record<string, ColumnDefinition<any>>>()

  for (const [model, metadata] of entries) {
    const modelDefinitions: Record<string, ColumnDefinition<any>> = {
      id: idDefinition(dialect, options),
    }
    const sqlNames = new Map<string, string>([["id", "id"]])

    for (const [field, attribute] of Object.entries(metadata.fields)) {
      const configuredSqlName = options.fieldNames?.[model]?.[field]
      const sqlName =
        configuredSqlName ?? (attribute.fieldName !== field ? attribute.fieldName : undefined)
      const effectiveSqlName = sqlName ?? generatedSchemaObjectName(field)
      const prior = sqlNames.get(effectiveSqlName)

      if (prior) {
        diagnostics.push({
          code: "duplicate-sql-name",
          message: `Better Auth fields ${model}.${prior} and ${model}.${field} both map to SQL column ${effectiveSqlName}.`,
          path: [model, "fields", field, "fieldName"],
        })
        continue
      }

      sqlNames.set(effectiveSqlName, field)
      const definition = fieldDefinition(
        attribute,
        sqlName,
        model,
        field,
        dialect,
        diagnostics,
        options,
        keyFields.get(model)?.has(field) === true,
      )

      if (definition) {
        modelDefinitions[field] = definition
      }
    }

    definitions.set(model, modelDefinitions)
  }

  validateReferences(authTables, diagnostics)

  if (diagnostics.length) {
    throw new BetterAuthSchemaError(diagnostics)
  }

  // Keep externally owned tables available to the adapter, but give schema() only tables it owns.
  const runtimeTables = buildTableMap(entries, definitions, authTables, diagnostics)

  // Table materialization adds diagnostics for malformed compound indexes; surface them before
  // creating the migration map.
  if (diagnostics.length) {
    throw new BetterAuthSchemaError(diagnostics)
  }

  const migrationTables = buildTableMap(
    entries.filter(([, metadata]) => !metadata.disableMigrations),
    definitions,
    authTables,
    undefined,
  )
  const result = schema(migrationTables) as BetterAuthQubuSchema
  const byPhysicalName = new Map<string, AnyTable>()

  for (const [model, metadata] of entries) {
    const resolved = migrationTables[model] ?? runtimeTables[model]

    if (resolved) {
      byPhysicalName.set(metadata.modelName, resolved)
    }
  }

  return Object.freeze({
    ...result,
    betterAuth: authTables,
    tableFor(model: string) {
      const resolved = migrationTables[model] ?? runtimeTables[model] ?? byPhysicalName.get(model)

      if (!resolved) {
        throw new TypeError(`Unknown Better Auth model: ${model}`)
      }

      return resolved
    },
  }) as BetterAuthQubuSchema
}

function collectKeyFields(authTables: BetterAuthDBSchema): Map<string, Set<string>> {
  const keyFields = new Map<string, Set<string>>()
  const mark = (model: string, field: string) => {
    const fields = keyFields.get(model) ?? new Set<string>()

    fields.add(field)
    keyFields.set(model, fields)
  }

  for (const [model, metadata] of Object.entries(authTables)) {
    for (const [field, attribute] of Object.entries(metadata.fields)) {
      if (attribute.index || attribute.unique || attribute.sortable || attribute.references) {
        mark(model, field)
      }

      const reference = attribute.references

      // Both sides of a non-ID MySQL foreign key need bounded, compatible key storage.
      if (reference && reference.field !== "id") {
        mark(reference.model, reference.field)
      }
    }

    for (const compound of metadata.indexes ?? []) {
      for (const field of compound.fields) {
        mark(model, field)
      }
    }
  }

  return keyFields
}

function validateReferences(
  authTables: BetterAuthDBSchema,
  diagnostics: BetterAuthSchemaDiagnostic[],
): void {
  for (const [model, metadata] of Object.entries(authTables)) {
    for (const [field, attribute] of Object.entries(metadata.fields)) {
      const reference = attribute.references

      if (!reference) {
        continue
      }

      const referenced = authTables[reference.model]

      if (!referenced) {
        diagnostics.push({
          code: "invalid-reference",
          message: `Better Auth field ${model}.${field} references unknown model ${reference.model}.`,
          path: [model, "fields", field, "references"],
        })
      } else if (reference.field !== "id" && !referenced.fields[reference.field]) {
        diagnostics.push({
          code: "invalid-reference",
          message: `Better Auth field ${model}.${field} references unknown field ${reference.model}.${reference.field}.`,
          path: [model, "fields", field, "references"],
        })
      }
    }
  }
}

function buildTableMap(
  entries: readonly BetterAuthTableEntry[],
  definitions: ReadonlyMap<string, Record<string, ColumnDefinition<any>>>,
  authTables: BetterAuthDBSchema,
  diagnostics: BetterAuthSchemaDiagnostic[] | undefined,
): BetterAuthTableMap {
  const tables: BetterAuthTableMap = {}
  const availableModels = new Set(entries.map(([model]) => model))
  const allocateIndexName = createIndexNameAllocator(entries)

  for (const [model, metadata] of entries) {
    const modelDefinitions = definitions.get(model)

    if (!modelDefinitions) {
      continue
    }

    tables[model] = table(metadata.modelName, modelDefinitions, (runtimeTable) => {
      const constraints: Record<string, any> = {
        primary: (primaryKey as any)(runtimeTable.columns.id),
      }
      const indexes: Record<string, any> = {}

      for (const [field, attribute] of Object.entries(metadata.fields)) {
        const column = runtimeTable.columns[field]

        if (!column) {
          continue
        }

        // A foreign key can only be materialized when its target is in this map; the migration
        // map intentionally omits externally owned targets.
        if (attribute.references && availableModels.has(attribute.references.model)) {
          const reference = attribute.references

          if (hasReferenceTarget(authTables, reference)) {
            constraints[`${field}Reference`] = (foreignKey as any)(
              [column] as [any],
              () => {
                const referencedTable = tables[reference.model]
                const referencedColumn = referencedTable?.columns[reference.field]

                if (!referencedTable || !referencedColumn) {
                  throw new BetterAuthSchemaError([
                    {
                      code: "invalid-reference",
                      message: `Better Auth field ${model}.${field} references unknown target ${reference.model}.${reference.field}.`,
                      path: [model, "fields", field, "references"],
                    },
                  ])
                }

                return references(referencedTable, referencedColumn)
              },
              {
                onDelete: reference.onDelete?.replace(" ", "-") as any,
              },
            )
          }
        }

        if (attribute.unique) {
          constraints[`${field}Unique`] =
            attribute.required === false
              ? (uniqueConstraint as any)(column)
              : (unique as any)(column)
        } else if (attribute.index) {
          indexes[`${field}Index`] = (index as any)([column], {
            physicalName: allocateIndexName(runtimeTable.tableName, [column.columnName]),
          })
        }
      }

      for (const [position, compound] of (metadata.indexes ?? []).entries()) {
        const columns = compound.fields.map((field) => runtimeTable.columns[field])

        if (columns.some((column) => !column)) {
          diagnostics?.push({
            code: "unknown-index-field",
            message: `Better Auth index ${model}.${compound.name ?? position} names an unknown field.`,
            path: [model, "indexes", String(position), "fields"],
          })
          continue
        }

        const key = compound.name ?? `compound${position + 1}`
        const physicalName =
          compound.name ??
          allocateIndexName(
            runtimeTable.tableName,
            columns.map((column) => column.columnName),
          )

        indexes[key] = (index as any)(columns, {
          unique: compound.unique,
          physicalName,
        })
      }

      return {
        constraints,
        indexes,
      } as any
    })
  }

  return tables
}

function hasReferenceTarget(
  authTables: BetterAuthDBSchema,
  reference: BetterAuthReference,
): boolean {
  const referenced = authTables[reference.model]

  return (
    referenced !== undefined &&
    (reference.field === "id" || referenced.fields[reference.field] !== undefined)
  )
}

function idDefinition(
  dialect: BetterAuthDialect,
  options: BetterAuthSchemaOptions,
): ColumnDefinition<any> {
  if (options.generateId === "serial") {
    return integer({
      sqlName: "id",
      identity: identityColumn(
        "by-default",
        dialect === "postgresql"
          ? undefined
          : {
              dialect: {
                dialect,
                autoIncrement: true,
              } as any,
            },
      ),
    })
  }

  if (dialect === "postgresql" && options.generateId === "uuid") {
    return uuid({
      sqlName: "id",
      default: postgresUuidDefault,
    })
  }

  if (dialect === "mysql") {
    return mysqlNativeColumn<string>(mysqlIdStorage, { sqlName: "id" })
  }

  return text({ sqlName: "id" })
}

function referenceIdDefinition(
  dialect: BetterAuthDialect,
  options: BetterAuthSchemaOptions,
  columnOptions: Record<string, unknown>,
): ColumnDefinition<any> {
  if (options.generateId === "serial") {
    return integer(columnOptions as any)
  }

  if (dialect === "postgresql" && options.generateId === "uuid") {
    return uuid(columnOptions as any)
  }

  if (dialect === "mysql") {
    return mysqlNativeColumn<string>(mysqlIdStorage, columnOptions)
  }

  return text(columnOptions as any)
}

function mysqlNativeColumn<TOutput>(
  storageType: string,
  options: Record<string, unknown>,
): ColumnDefinition<any> {
  return nativeColumn<TOutput, TOutput, TOutput>(
    nativeStorage("mysql", storageType),
    options as any,
  ) as ColumnDefinition<any>
}

type IndexNameAllocator = (tableName: string, fields: readonly string[]) => string

function createIndexNameAllocator(entries: readonly BetterAuthTableEntry[]): IndexNameAllocator {
  // PostgreSQL shares a namespace between tables and indexes, so reserve both kinds of names.
  const reservedNames = new Set<string>()

  for (const [, metadata] of entries) {
    reservedNames.add(metadata.modelName)

    for (const compound of metadata.indexes ?? []) {
      if (compound.name !== undefined) {
        reservedNames.add(compound.name)
      }
    }
  }

  const allocatedNames = new Set<string>()

  return (tableName, fields) => {
    const base = generatedSchemaObjectName([tableName, ...fields, "index"].join("_"))
    let physicalName = boundedSchemaObjectName(base)
    let attempt = 0

    while (reservedNames.has(physicalName) || allocatedNames.has(physicalName)) {
      attempt += 1
      physicalName = boundedSchemaObjectName(
        `${base}_${stableSchemaNameHash(`${base}:${attempt}`)}`,
      )
    }

    allocatedNames.add(physicalName)
    return physicalName
  }
}

/** PostgreSQL's identifier limit, measured in UTF-8 bytes rather than characters. */
const maxSchemaObjectNameBytes = 63

function boundedSchemaObjectName(value: string): string {
  if (utf8ByteLength(value) <= maxSchemaObjectNameBytes) {
    return value
  }

  const suffix = `_${stableSchemaNameHash(value)}`

  return `${truncateUtf8(value, maxSchemaObjectNameBytes - utf8ByteLength(suffix))}${suffix}`
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ""
  let bytes = 0

  for (const character of value) {
    const characterBytes = utf8ByteLength(character)

    if (bytes + characterBytes > maxBytes) {
      break
    }

    result += character
    bytes += characterBytes
  }

  return result
}

function stableSchemaNameHash(value: string): string {
  let hash = 2166136261

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function resolveSchemaOptions(options: BetterAuthOptions): BetterAuthSchemaOptions {
  const fieldNames: Record<string, Record<string, string>> = {}
  const assign = (model: string, field: string, sqlName: unknown) => {
    if (sqlName === field) {
      const modelFieldNames = (fieldNames[model] ??= {})

      modelFieldNames[field] = sqlName
    }
  }

  for (const [model, candidate] of Object.entries(options)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue
    }

    if ("fields" in candidate && candidate.fields && typeof candidate.fields === "object") {
      for (const [field, sqlName] of Object.entries(candidate.fields)) {
        assign(model, field, sqlName)
      }
    }

    if (
      "additionalFields" in candidate &&
      candidate.additionalFields &&
      typeof candidate.additionalFields === "object"
    ) {
      for (const [field, attribute] of Object.entries(candidate.additionalFields)) {
        assign(
          model,
          field,
          attribute && typeof attribute === "object" && "fieldName" in attribute
            ? attribute.fieldName
            : undefined,
        )
      }
    }
  }

  for (const plugin of options.plugins ?? []) {
    for (const [model, metadata] of Object.entries(plugin.schema ?? {})) {
      for (const [field, attribute] of Object.entries(metadata.fields)) {
        assign(model, field, attribute.fieldName)
      }
    }
  }

  return {
    generateId:
      options.advanced?.database?.generateId === "serial" ||
      options.advanced?.database?.generateId === "uuid"
        ? options.advanced.database.generateId
        : undefined,
    ...(Object.keys(fieldNames).length ? { fieldNames } : {}),
  }
}

function fieldDefinition(
  attribute: DBFieldAttribute,
  sqlName: string | undefined,
  model: string,
  field: string,
  dialect: BetterAuthDialect,
  diagnostics: BetterAuthSchemaDiagnostic[],
  schemaOptions: BetterAuthSchemaOptions,
  keyBearing: boolean,
): ColumnDefinition<any> | undefined {
  const defaultValue = attribute.defaultValue
  const columnOptions: Record<string, unknown> = {
    ...(sqlName === undefined ? {} : { sqlName }),
    nullable: attribute.required === false,
    ...(defaultValue === undefined
      ? {}
      : {
          default:
            typeof defaultValue === "function"
              ? attribute.type === "date" && dialect !== "sqlite"
                ? dialect === "mysql"
                  ? mysqlCurrentTimestampDefault
                  : currentTimestampDefault
                : externalDefault()
              : defaultValue instanceof Date || typeof defaultValue === "object"
                ? externalDefault()
                : defaultValue,
        }),
  }

  if (attribute.references?.field === "id") {
    return referenceIdDefinition(dialect, schemaOptions, columnOptions)
  }

  switch (attribute.type) {
    case "string": {
      return dialect === "mysql" && keyBearing
        ? mysqlNativeColumn<string>(mysqlKeyStorage, columnOptions)
        : text(columnOptions)
    }

    case "number": {
      return attribute.bigint
        ? defineColumn<number>({
            ...columnOptions,
            storage: portableStorage("bigint"),
            decode(value) {
              const decoded = Number(value)

              if (!Number.isSafeInteger(decoded)) {
                throw new TypeError(
                  `Better Auth bigint field ${model}.${field} returned a value outside JavaScript's safe integer range.`,
                )
              }

              return decoded
            },
          })
        : integer(columnOptions)
    }

    case "boolean": {
      return boolean({
        ...columnOptions,
        decode: booleanResultDecoder,
      })
    }

    case "date": {
      const dateOptions = {
        ...columnOptions,
        decode: timestampResultDecoder,
      }

      return dialect === "mysql"
        ? mysqlNativeColumn<Date>(mysqlTimestampStorage, dateOptions)
        : timestamp(dateOptions)
    }

    case "json":
    case "string[]":
    case "number[]": {
      return json({
        ...columnOptions,
        decode: jsonTextResultDecoder,
      })
    }

    default: {
      if (Array.isArray(attribute.type)) {
        diagnostics.push({
          code: "unsupported-field-type",
          message: `Better Auth enum field ${model}.${field} cannot be represented losslessly as a Qubu column.`,
          path: [model, "fields", field, "type"],
        })
        return undefined
      }

      diagnostics.push({
        code: "unsupported-field-type",
        message: `Better Auth field ${model}.${field} has unsupported type ${String(attribute.type)}.`,
        path: [model, "fields", field, "type"],
      })
      return undefined
    }
  }
}
