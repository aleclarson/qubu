import type { Source, SourceColumns } from "qubu"
import type { ColumnReference } from "qubu"
import { assertDialectCapability, identifier } from "qubu/core"
import type { RequiresCapabilityMeta } from "qubu/core"
import type {
  AnyTable,
  ColumnDefinition,
  ColumnOutput,
  TableDefinitions,
  UnknownSourceSqlTypes,
} from "qubu/schema"
import { customSource, integer, text } from "qubu/schema"

export const fts5Capability = "sqlite-fts5" as const
export type Fts5Capability = typeof fts5Capability

export type Fts5SyncMode = "triggers" | "manual"
export type Fts5Detail = "full" | "column" | "none"

/** A column definition for an inline FTS5 table, or a source column for external content. */
export type Fts5ColumnSpec =
  | ColumnDefinition<any>
  | ColumnReference<any, any>
  | {
      readonly column: ColumnReference<any, any>
      readonly unindexed?: boolean
    }
  | {
      readonly definition: ColumnDefinition<any>
      readonly unindexed?: boolean
    }

export type Fts5ColumnMap = Readonly<Record<string, Fts5ColumnSpec>>

export interface Fts5ColumnDescriptor {
  /** The application-facing field passed to `fts5.highlight()` or `fts5.snippet()`. */
  readonly fieldName: string
  /** The physical column declared in the FTS5 virtual table. */
  readonly name: string
  readonly unindexed: boolean
  /** The physical column selected from an external content table, when applicable. */
  readonly sourceColumn?: string
}

export interface Fts5ExternalContent {
  readonly table: string
  readonly rowid: string
}

/** Canonical FTS5 metadata retained by snapshot and migration helpers. */
export interface Fts5Definition<TName extends string = string> {
  readonly kind: "sqlite-fts5"
  readonly name: TName
  readonly columns: readonly Fts5ColumnDescriptor[]
  readonly content: "inline" | "contentless" | Fts5ExternalContent
  readonly tokenize?: string
  readonly prefix?: readonly number[]
  readonly detail?: Fts5Detail
  readonly columnsize?: boolean
  readonly contentlessDelete?: boolean
  readonly sync: "none" | Fts5SyncMode
  readonly shadowNames: readonly string[]
  readonly triggerNames: readonly string[]
  readonly createSql: string
  readonly installSql: readonly string[]
  readonly uninstallSql: readonly string[]
}

type UnwrappedFts5Spec<T> = T extends { readonly column: infer TColumn }
  ? TColumn
  : T extends { readonly definition: infer TDefinition }
    ? TDefinition
    : T

type Fts5FieldOutput<T> =
  UnwrappedFts5Spec<T> extends infer TSpec
    ? TSpec extends ColumnReference<any, any>
      ? import("qubu/core").OutputOf<TSpec> | null
      : TSpec extends ColumnDefinition<any>
        ? ColumnOutput<TSpec>
        : unknown
    : never

export type Fts5Row<TColumns extends object> = {
  -readonly [K in Exclude<keyof TColumns, "rowid">]: Fts5FieldOutput<TColumns[K]>
} & {
  readonly rowid: number
}

export type Fts5SqlTypes<TColumns extends object> = UnknownSourceSqlTypes<Fts5Row<TColumns>>

export type Fts5Identity<TName extends string = string> = {
  readonly sourceKind: "sqlite-fts5"
  readonly name: TName
}

type Fts5SourceConfig<TName extends string, TColumns extends object> = {
  readonly identity: Fts5Identity<TName>
  readonly row: Fts5Row<TColumns>
  readonly metadata: RequiresCapabilityMeta<Fts5Capability>
  readonly sqlTypes: Fts5SqlTypes<TColumns>
}

/** A typed FTS5 virtual-table source. It is deliberately not an `AnyTable`. */
export type Fts5Source<TName extends string = string, TColumns extends object = {}> = Source<
  Fts5SourceConfig<TName, TColumns>
> & {
  readonly name: TName
  readonly fts5: Fts5Definition<TName>
  readonly definitions: TableDefinitions
  readonly columns: SourceColumns<Fts5Row<TColumns>, Fts5Identity<TName>, Fts5SqlTypes<TColumns>>
} & SourceColumns<Fts5Row<TColumns>, Fts5Identity<TName>, Fts5SqlTypes<TColumns>>

type TableColumn<TContent extends AnyTable> = Extract<
  TContent["columns"][keyof TContent["columns"]],
  ColumnReference<any, any>
>

export interface Fts5TableOptions<
  TName extends string = string,
  TColumns extends object = Fts5ColumnMap,
  TContent extends AnyTable | "" | undefined = AnyTable | "" | undefined,
> {
  readonly name: TName
  readonly columns: TColumns
  readonly content?: TContent
  readonly contentRowid?: TContent extends AnyTable ? TableColumn<TContent> : never
  readonly tokenize?: string
  readonly prefix?: readonly number[]
  readonly detail?: Fts5Detail
  readonly columnsize?: boolean
  readonly contentlessDelete?: boolean
  /** External-content tables use triggers by default; manual mode leaves synchronization to callers. */
  readonly sync?: Fts5SyncMode
}

type RequiredContentOptions<
  TContent extends AnyTable | "" | undefined,
  TOptions,
> = TContent extends AnyTable
  ? TOptions & {
      readonly content: TContent
      readonly contentRowid: TableColumn<TContent>
    }
  : TOptions & {
      readonly content?: TContent
      readonly contentRowid?: never
    }

type NormalizedColumn = {
  readonly definition?: ColumnDefinition<any>
  readonly reference?: ColumnReference<any, any>
  readonly unindexed: boolean
}

/** Declare an FTS5 virtual-table source and its canonical SQLite DDL. */
export function table<
  const TName extends string,
  const TColumns extends object,
  const TContent extends AnyTable | "" | undefined = undefined,
>(
  options: RequiredContentOptions<
    TContent,
    Fts5TableOptions<TName, TColumns, TContent> & {
      readonly columns: TColumns & { readonly [K in keyof TColumns]: Fts5ColumnSpec }
    }
  >,
): Fts5Source<TName, TColumns> {
  validateName(options.name, "FTS5 table")

  const content = options.content
  const externalContent = isTable(content) ? content : undefined

  if (externalContent !== undefined && options.contentRowid === undefined) {
    throw new TypeError("An external-content FTS5 table requires contentRowid")
  }

  if (externalContent === undefined && options.contentRowid !== undefined) {
    throw new TypeError("contentRowid is only valid with an external content table")
  }

  if (options.contentlessDelete === true && content !== "") {
    throw new TypeError("contentlessDelete is only valid for a contentless FTS5 table")
  }

  const rawColumns = Object.entries(options.columns as Record<string, Fts5ColumnSpec>).map(
    ([fieldName, spec]) => {
      const normalized = normalizeColumnSpec(fieldName, spec)

      return {
        fieldName,
        ...normalized,
      }
    },
  )

  if (rawColumns.length === 0) {
    throw new TypeError("An FTS5 table requires at least one column")
  }

  const sqlNames = resolveFieldNames(
    rawColumns.map(({ fieldName, definition, reference }) => ({
      fieldName,
      sqlName: reference?.columnName ?? definition?.sqlName,
    })),
  )

  const columns: Fts5ColumnDescriptor[] = rawColumns.map(({ fieldName, reference, unindexed }) => {
    const name = sqlNames[fieldName]

    if (name === "rowid") {
      throw new TypeError('An FTS5 field cannot be named "rowid"')
    }

    if (externalContent !== undefined && reference === undefined) {
      throw new TypeError(
        `External-content FTS5 field "${fieldName}" must reference a content-table column`,
      )
    }

    return {
      fieldName,
      name,
      unindexed,
      ...(reference === undefined ? {} : { sourceColumn: reference.columnName }),
    }
  })

  const runtimeDefinitions = Object.fromEntries([
    ...rawColumns.map(({ fieldName, definition, reference }) => [
      fieldName,
      definition ??
        text({
          sqlName: reference?.columnName,
          nullable: true,
        }),
    ]),
    ["rowid", integer({ sqlName: "rowid" })],
  ]) as TableDefinitions

  const ftsContent: Fts5Definition["content"] =
    content === ""
      ? "contentless"
      : externalContent === undefined
        ? "inline"
        : {
            table: externalContent.tableName,
            rowid: (options.contentRowid as ColumnReference).columnName,
          }

  const sync: Fts5Definition["sync"] =
    externalContent === undefined ? "none" : (options.sync ?? "triggers")
  const triggerNames =
    externalContent === undefined || sync !== "triggers"
      ? []
      : [`${options.name}_ai`, `${options.name}_ad`, `${options.name}_au`]

  const definition = createDefinition({
    name: options.name,
    columns,
    content: ftsContent,
    tokenize: options.tokenize,
    prefix: options.prefix,
    detail: options.detail,
    columnsize: options.columnsize,
    contentlessDelete: options.contentlessDelete,
    sync,
    triggerNames,
  })

  const source = customSource<
    Fts5Identity<TName>,
    TableDefinitions,
    RequiresCapabilityMeta<Fts5Capability>
  >({
    identity: {
      sourceKind: "sqlite-fts5",
      name: options.name,
    },
    sourceKind: "custom",
    render(context) {
      assertDialectCapability(context.dialect, fts5Capability)
      context.render(identifier(options.name))
    },
    reference: identifier(options.name),
    columns: runtimeDefinitions,
  })

  Object.assign(source, {
    name: options.name,
    fts5: definition,
  })

  return Object.freeze(source) as unknown as Fts5Source<TName, TColumns>
}

function createDefinition(options: {
  readonly name: string
  readonly columns: readonly Fts5ColumnDescriptor[]
  readonly content: Fts5Definition["content"]
  readonly tokenize?: string
  readonly prefix?: readonly number[]
  readonly detail?: Fts5Detail
  readonly columnsize?: boolean
  readonly contentlessDelete?: boolean
  readonly sync: Fts5Definition["sync"]
  readonly triggerNames: readonly string[]
}): Fts5Definition {
  const prefix = normalizePrefix(options.prefix)
  const tokenize = normalizeOptionalText(options.tokenize, "tokenize")
  const createSql = renderCreateSql({
    ...options,
    prefix,
    tokenize,
  })
  const shadowNames = [
    `${options.name}_config`,
    `${options.name}_content`,
    `${options.name}_data`,
    `${options.name}_docsize`,
    `${options.name}_idx`,
  ]
  const installSql = [
    createSql,
    ...(options.content === "inline" || options.content === "contentless"
      ? []
      : options.triggerNames.map((triggerName, index) =>
          renderTriggerSql(
            options,
            triggerName,
            index === 0 ? "insert" : index === 1 ? "delete" : "update",
          ),
        )),
    ...(options.content === "inline" || options.content === "contentless"
      ? []
      : [renderBackfillSql(options)]),
  ]
  const uninstallSql = [
    ...options.triggerNames.map((triggerName) => `DROP TRIGGER ${quoteIdentifier(triggerName)}`),
    `DROP TABLE ${quoteIdentifier(options.name)}`,
  ]

  return Object.freeze({
    kind: "sqlite-fts5",
    name: options.name,
    columns: Object.freeze(options.columns.map((column) => Object.freeze({ ...column }))),
    content: options.content,
    ...(tokenize === undefined ? {} : { tokenize }),
    ...(prefix === undefined ? {} : { prefix: Object.freeze(prefix) }),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.columnsize === undefined ? {} : { columnsize: options.columnsize }),
    ...(options.contentlessDelete === undefined
      ? {}
      : { contentlessDelete: options.contentlessDelete }),
    sync: options.sync,
    shadowNames: Object.freeze(shadowNames),
    triggerNames: Object.freeze([...options.triggerNames]),
    createSql,
    installSql: Object.freeze(installSql),
    uninstallSql: Object.freeze(uninstallSql),
  })
}

function renderCreateSql(options: {
  readonly name: string
  readonly columns: readonly Fts5ColumnDescriptor[]
  readonly content: Fts5Definition["content"]
  readonly tokenize?: string
  readonly prefix?: readonly number[]
  readonly detail?: Fts5Detail
  readonly columnsize?: boolean
  readonly contentlessDelete?: boolean
}): string {
  const columnSql = options.columns.map(
    (column) => `${quoteIdentifier(column.name)}${column.unindexed ? " UNINDEXED" : ""}`,
  )
  const optionSql: string[] = []

  if (options.content === "contentless") {
    optionSql.push(`content=${quoteLiteral("")}`)
  } else if (options.content !== "inline") {
    optionSql.push(`content=${quoteLiteral(options.content.table)}`)
    optionSql.push(`content_rowid=${quoteLiteral(options.content.rowid)}`)
  }

  if (options.tokenize !== undefined) {
    optionSql.push(`tokenize=${quoteLiteral(options.tokenize)}`)
  }

  if (options.prefix !== undefined) {
    optionSql.push(`prefix=${quoteLiteral(options.prefix.join(" "))}`)
  }

  if (options.detail !== undefined) {
    optionSql.push(`detail=${quoteLiteral(options.detail)}`)
  }

  if (options.columnsize !== undefined) {
    optionSql.push(`columnsize=${options.columnsize ? "1" : "0"}`)
  }

  if (options.contentlessDelete === true) {
    optionSql.push("contentless_delete=1")
  }

  return `CREATE VIRTUAL TABLE ${quoteIdentifier(options.name)} USING fts5(${[
    ...columnSql,
    ...optionSql,
  ].join(", ")})`
}

function renderBackfillSql(options: {
  readonly name: string
  readonly columns: readonly Fts5ColumnDescriptor[]
  readonly content: Fts5Definition["content"]
}): string {
  if (options.content === "inline" || options.content === "contentless") {
    throw new TypeError("Only external-content FTS5 tables can be backfilled")
  }

  const targetColumns = ["rowid", ...options.columns.map((column) => column.name)]
  const content = options.content
  const sourceColumns = [
    content.rowid,
    ...options.columns.map((column) => {
      if (column.sourceColumn === undefined) {
        throw new TypeError(`FTS5 field "${column.fieldName}" has no external source column`)
      }

      return column.sourceColumn
    }),
  ]

  return `INSERT INTO ${quoteIdentifier(options.name)} (${targetColumns.map(quoteIdentifier).join(", ")}) SELECT ${sourceColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(content.table)}`
}

function renderTriggerSql(
  options: {
    readonly name: string
    readonly columns: readonly Fts5ColumnDescriptor[]
    readonly content: Fts5Definition["content"]
  },
  triggerName: string,
  event: "insert" | "delete" | "update",
): string {
  if (options.content === "inline" || options.content === "contentless") {
    throw new TypeError("Only external-content FTS5 tables can have synchronization triggers")
  }

  const content = options.content
  const targetColumns = ["rowid", ...options.columns.map((column) => column.name)]
  const sourceColumns = [
    content.rowid,
    ...options.columns.map((column) => {
      if (column.sourceColumn === undefined) {
        throw new TypeError(`FTS5 field "${column.fieldName}" has no external source column`)
      }

      return column.sourceColumn
    }),
  ]
  const target = quoteIdentifier(options.name)
  const table = quoteIdentifier(content.table)
  const insert = (prefix: "new" | "old", command?: "delete") => {
    const columns = command === undefined ? targetColumns : [options.name, ...targetColumns]
    const values =
      command === undefined
        ? sourceColumns.map((column) => `${prefix}.${quoteIdentifier(column)}`)
        : [
            quoteLiteral(command),
            `${prefix}.${quoteIdentifier(content.rowid)}`,
            ...sourceColumns.slice(1).map((column) => `${prefix}.${quoteIdentifier(column)}`),
          ]

    return `INSERT INTO ${target} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${values.join(", ")})`
  }

  const statements =
    event === "insert"
      ? [insert("new")]
      : event === "delete"
        ? [insert("old", "delete")]
        : [insert("old", "delete"), insert("new")]

  const timing = event === "insert" ? "INSERT" : event === "delete" ? "DELETE" : "UPDATE"

  return `CREATE TRIGGER ${quoteIdentifier(triggerName)} AFTER ${timing} ON ${table} BEGIN ${statements.join("; ")}; END`
}

function normalizeColumnSpec(fieldName: string, spec: Fts5ColumnSpec): NormalizedColumn {
  if (isColumnDefinition(spec)) {
    return {
      definition: spec,
      unindexed: false,
    }
  }

  if (isColumnReference(spec)) {
    return {
      reference: spec,
      unindexed: false,
    }
  }

  if (typeof spec === "object" && spec !== null && "column" in spec) {
    if (!isColumnReference(spec.column)) {
      throw new TypeError(`FTS5 field "${fieldName}" must use a ColumnReference`)
    }

    return {
      reference: spec.column,
      unindexed: spec.unindexed === true,
    }
  }

  if (typeof spec === "object" && spec !== null && "definition" in spec) {
    if (!isColumnDefinition(spec.definition)) {
      throw new TypeError(`FTS5 field "${fieldName}" must use a ColumnDefinition`)
    }

    return {
      definition: spec.definition,
      unindexed: spec.unindexed === true,
    }
  }

  throw new TypeError(`FTS5 field "${fieldName}" is not a column definition or reference`)
}

function isColumnDefinition(value: unknown): value is ColumnDefinition<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "definitionKind" in value &&
    value.definitionKind === "column"
  )
}

function isColumnReference(value: unknown): value is ColumnReference<any, any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "expressionKind" in value &&
    value.expressionKind === "column" &&
    "columnName" in value &&
    typeof value.columnName === "string"
  )
}

function isTable(value: unknown): value is AnyTable {
  return (
    typeof value === "object" &&
    value !== null &&
    "tableName" in value &&
    typeof value.tableName === "string" &&
    "columns" in value
  )
}

function normalizePrefix(prefix: readonly number[] | undefined): readonly number[] | undefined {
  if (prefix === undefined) {
    return undefined
  }

  const normalized = [...new Set(prefix)].sort((left, right) => left - right)

  if (normalized.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new TypeError("FTS5 prefix lengths must be positive integers")
  }

  return normalized
}

function normalizeOptionalText(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value.length === 0) {
    throw new TypeError(`FTS5 ${name} cannot be empty`)
  }

  return value
}

function resolveFieldNames(
  fields: readonly {
    readonly fieldName: string
    readonly sqlName?: string
  }[],
): Readonly<Record<string, string>> {
  const names: Record<string, string> = {}
  const owners = new Map<string, string>()

  for (const field of fields) {
    const name = field.sqlName ?? snakeCase(field.fieldName)

    if (name.length === 0) {
      throw new TypeError(`SQL name for field "${field.fieldName}" cannot be empty`)
    }

    const owner = owners.get(name)

    if (owner !== undefined) {
      throw new TypeError(
        `Fields "${owner}" and "${field.fieldName}" both resolve to SQL name "${name}"`,
      )
    }

    owners.set(name, field.fieldName)
    names[field.fieldName] = name
  }

  return Object.freeze(names)
}

function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
}

function validateName(name: string, subject: string): void {
  if (name.length === 0 || name.includes("\u0000")) {
    throw new TypeError(`${subject} name cannot be empty or contain NUL`)
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
