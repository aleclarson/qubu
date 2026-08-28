import type { BetterAuthOptions } from 'better-auth/types'
import type { BetterAuthDBSchema, DBFieldAttribute } from 'better-auth/db'
import { getAuthTables } from 'better-auth/db'
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
} from 'qubu'
import { defineSchemaExpression } from 'qubu/schema'

const postgresUuidDefault = defineSchemaExpression('function', context => {
  context.append('pg_catalog.gen_random_uuid()')
})
const currentTimestampDefault = defineSchemaExpression('function', context => {
  context.append('CURRENT_TIMESTAMP')
})
const mysqlCurrentTimestampDefault = defineSchemaExpression(
  'function',
  context => {
    context.append('CURRENT_TIMESTAMP(3)')
  }
)

/** SQL dialects whose Better Auth behavior is implemented by this package. */
export type BetterAuthDialect = 'postgresql' | 'mysql' | 'sqlite'

/** One actionable, path-addressed schema conversion failure. */
export interface BetterAuthSchemaDiagnostic {
  readonly code:
    | 'unsupported-field-type'
    | 'unknown-index-field'
    | 'duplicate-sql-name'
    | 'invalid-reference'
  readonly message: string
  readonly path: readonly string[]
}

/** Raised when Better Auth metadata cannot be represented losslessly by Qubu. */
export class BetterAuthSchemaError extends TypeError {
  readonly name = 'BetterAuthSchemaError'
  readonly diagnostics: readonly BetterAuthSchemaDiagnostic[]
  readonly issues: readonly BetterAuthSchemaDiagnostic[]

  constructor(diagnostics: readonly BetterAuthSchemaDiagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join('\n'))
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

/** Derive Qubu tables from Better Auth's resolved public database metadata. */
export function betterAuthSchema(
  options: BetterAuthOptions,
  dialect: BetterAuthDialect
): BetterAuthQubuSchema {
  return betterAuthSchemaFromTables(getAuthTables(options), dialect, options)
}

/** Derive Qubu tables from already-resolved Better Auth database metadata. */
export function betterAuthSchemaFromTables(
  authTables: BetterAuthDBSchema,
  dialect: BetterAuthDialect,
  options?: BetterAuthOptions
): BetterAuthQubuSchema {
  const diagnostics: BetterAuthSchemaDiagnostic[] = []
  const tables: Record<string, AnyTable> = {}
  const numberIds = options?.advanced?.database?.generateId === 'serial'

  for (const [model, metadata] of Object.entries(authTables)) {
    if (metadata.disableMigrations) continue
    const definitions: Record<string, ColumnDefinition<any>> = {
      id: numberIds
        ? integer({
            sqlName: 'id',
            identity: identityColumn(
              'by-default',
              dialect === 'postgresql'
                ? undefined
                : {
                    dialect: {
                      dialect,
                      autoIncrement: true,
                    } as any,
                  }
            ),
          })
        : dialect === 'postgresql' &&
            options?.advanced?.database?.generateId === 'uuid'
          ? uuid({ sqlName: 'id', default: postgresUuidDefault })
          : text({ sqlName: 'id' }),
    }
    const sqlNames = new Map<string, string>([['id', 'id']])
    for (const [field, attribute] of Object.entries(metadata.fields)) {
      const sqlName = attribute.fieldName ?? field
      const prior = sqlNames.get(sqlName)
      if (prior) {
        diagnostics.push({
          code: 'duplicate-sql-name',
          message: `Better Auth fields ${model}.${prior} and ${model}.${field} both map to SQL column ${sqlName}.`,
          path: [model, 'fields', field, 'fieldName'],
        })
        continue
      }
      sqlNames.set(sqlName, field)
      const definition = fieldDefinition(
        attribute,
        sqlName,
        model,
        field,
        dialect,
        diagnostics
      )
      if (definition) definitions[field] = definition
    }

    tables[model] = table(metadata.modelName, definitions, runtimeTable => {
      const constraints: Record<string, any> = {
        primary: (primaryKey as any)(runtimeTable.columns.id),
      }
      const indexes: Record<string, any> = {}
      for (const [field, attribute] of Object.entries(metadata.fields)) {
        const column = runtimeTable.columns[field]
        if (!column) continue
        if (attribute.references) {
          const reference = attribute.references
          constraints[`${field}Reference`] = (foreignKey as any)(
            [column] as [any],
            () => {
              const referencedTable = tables[reference.model]
              const referencedColumn = referencedTable?.columns[reference.field]
              if (!referencedTable || !referencedColumn) {
                throw new BetterAuthSchemaError([
                  {
                    code: 'invalid-reference',
                    message: `Better Auth field ${model}.${field} references unknown target ${reference.model}.${reference.field}.`,
                    path: [model, 'fields', field, 'references'],
                  },
                ])
              }
              return references(referencedTable, referencedColumn)
            },
            {
              onDelete: reference.onDelete?.replace(' ', '-') as any,
            }
          )
        }
        if (attribute.unique) {
          constraints[`${field}Unique`] =
            attribute.required === false
              ? (uniqueConstraint as any)(column)
              : (unique as any)(column)
        } else if (attribute.index) {
          indexes[`${field}Index`] = (index as any)([column])
        }
      }
      for (const [position, compound] of (metadata.indexes ?? []).entries()) {
        const columns = compound.fields.map(
          field => runtimeTable.columns[field]
        )
        if (columns.some(column => !column)) {
          diagnostics.push({
            code: 'unknown-index-field',
            message: `Better Auth index ${model}.${compound.name ?? position} names an unknown field.`,
            path: [model, 'indexes', String(position), 'fields'],
          })
          continue
        }
        const key = compound.name ?? `compound${position + 1}`
        indexes[key] = (index as any)(columns, {
          unique: compound.unique,
          physicalName: compound.name,
        })
      }
      return { constraints, indexes } as any
    })
  }

  for (const [model, metadata] of Object.entries(authTables)) {
    for (const [field, attribute] of Object.entries(metadata.fields)) {
      const reference = attribute.references
      if (!reference) continue
      const referenced = authTables[reference.model]
      if (!referenced || !tables[reference.model]) {
        diagnostics.push({
          code: 'invalid-reference',
          message: `Better Auth field ${model}.${field} references unknown model ${reference.model}.`,
          path: [model, 'fields', field, 'references'],
        })
      } else if (
        reference.field !== 'id' &&
        !referenced.fields[reference.field]
      ) {
        diagnostics.push({
          code: 'invalid-reference',
          message: `Better Auth field ${model}.${field} references unknown field ${reference.model}.${reference.field}.`,
          path: [model, 'fields', field, 'references'],
        })
      }
    }
  }
  if (diagnostics.length) throw new BetterAuthSchemaError(diagnostics)

  const result = schema(tables) as BetterAuthQubuSchema
  const byPhysicalName = new Map(
    Object.entries(authTables)
      .filter(([model]) => tables[model])
      .map(([model, metadata]) => [metadata.modelName, tables[model]!])
  )
  return Object.freeze({
    ...result,
    betterAuth: authTables,
    tableFor(model: string) {
      const resolved = tables[model] ?? byPhysicalName.get(model)
      if (!resolved) throw new TypeError(`Unknown Better Auth model: ${model}`)
      return resolved
    },
  }) as BetterAuthQubuSchema
}

function fieldDefinition(
  attribute: DBFieldAttribute,
  sqlName: string,
  model: string,
  field: string,
  dialect: BetterAuthDialect,
  diagnostics: BetterAuthSchemaDiagnostic[]
): ColumnDefinition<any> | undefined {
  const defaultValue = attribute.defaultValue
  const options: any = {
    sqlName,
    nullable: attribute.required === false,
    ...(defaultValue === undefined
      ? {}
      : {
          default:
            typeof defaultValue === 'function'
              ? attribute.type === 'date' && dialect !== 'sqlite'
                ? dialect === 'mysql'
                  ? mysqlCurrentTimestampDefault
                  : currentTimestampDefault
                : externalDefault()
              : defaultValue instanceof Date || typeof defaultValue === 'object'
                ? externalDefault()
                : defaultValue,
        }),
  }
  switch (attribute.type) {
    case 'string':
      return text(options)
    case 'number':
      return attribute.bigint
        ? defineColumn<number>({
            ...options,
            storage: portableStorage('bigint'),
            decode(value) {
              const decoded = Number(value)
              if (!Number.isSafeInteger(decoded)) {
                throw new TypeError(
                  `Better Auth bigint field ${model}.${field} returned a value outside JavaScript's safe integer range.`
                )
              }
              return decoded
            },
          })
        : integer(options)
    case 'boolean':
      return boolean({ ...options, decode: booleanResultDecoder })
    case 'date':
      return timestamp({ ...options, decode: timestampResultDecoder })
    case 'json':
    case 'string[]':
    case 'number[]':
      return json({ ...options, decode: jsonTextResultDecoder })
    default:
      if (Array.isArray(attribute.type)) {
        diagnostics.push({
          code: 'unsupported-field-type',
          message: `Better Auth enum field ${model}.${field} cannot be represented losslessly as a Qubu column.`,
          path: [model, 'fields', field, 'type'],
        })
        return undefined
      }
      diagnostics.push({
        code: 'unsupported-field-type',
        message: `Better Auth field ${model}.${field} has unsupported type ${String(attribute.type)}.`,
        path: [model, 'fields', field, 'type'],
      })
      return undefined
  }
}
