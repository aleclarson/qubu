import {
  createAdapterFactory,
  type AdapterFactoryOptions,
  type CleanedWhere,
  type CustomAdapter,
  type DBAdapter,
  type JoinConfig,
} from "better-auth/adapters"
import type { BetterAuthOptions } from "better-auth/types"
import {
  add,
  allowAll,
  and,
  asc,
  count,
  deleteFrom,
  desc,
  eq,
  fetchFirst,
  from,
  gt,
  gte,
  inList,
  inQuery,
  insertInto,
  isNotNull,
  isNull,
  lower,
  lt,
  lte,
  ne,
  notIn,
  omit,
  offset,
  or,
  orderBy,
  returning,
  rowLock,
  select,
  sql,
  update,
  values,
  where,
  type AnyTable,
  type QubuClient,
  type QubuTransactionalClient,
  type QueryAdapter,
  type SqlBoolean,
  type TransactionalQueryAdapter,
} from "qubu"

import { betterAuthSchema, type BetterAuthDialect, type BetterAuthQubuSchema } from "./schema.ts"

/** Options for binding Better Auth to a transactional Qubu client. */
export interface QubuBetterAuthAdapterOptions {
  /** Derived schema may be shared with snapshot and migration workflows. */
  schema?: BetterAuthQubuSchema
}

type Client = QubuClient<QueryAdapter> | QubuTransactionalClient

/** Create a Better Auth database factory backed only by Qubu boundaries. */
export function qubuAdapter(client: Client, adapterOptions: QubuBetterAuthAdapterOptions = {}) {
  const dialect = assertDialect(client.adapter.dialect.name)

  if (!("transaction" in client) || typeof client.transaction !== "function") {
    throw new TypeError(
      "@qubu/better-auth requires a transactional Qubu client for atomic single-row operations.",
    )
  }

  const transactional = client as QubuTransactionalClient<TransactionalQueryAdapter, QueryAdapter>

  return (options: BetterAuthOptions) => {
    const activeSchema = adapterOptions.schema ?? betterAuthSchema(options, dialect)
    const factoryOptions: AdapterFactoryOptions = {
      config: {
        adapterId: "qubu",
        adapterName: "Qubu",
        supportsJSON: false,
        supportsDates: dialect !== "sqlite",
        supportsBooleans: dialect === "postgresql",
        supportsArrays: false,
        supportsNumericIds: true,
        transaction: (callback) =>
          transactional.transaction((scoped) => {
            const scopedAdapter: DBAdapter = createAdapterFactory({
              config: {
                ...factoryOptions.config,
                transaction: false,
              },
              adapter: () => buildAdapter(scoped, activeSchema, dialect, options, true),
            })(options)

            return callback(scopedAdapter)
          }),
      },
      adapter: () => buildAdapter(transactional, activeSchema, dialect, options),
    }

    return createAdapterFactory(factoryOptions)(options)
  }
}

function buildAdapter(
  client: QubuClient,
  authSchema: BetterAuthQubuSchema,
  dialect: BetterAuthDialect,
  betterAuthOptions: BetterAuthOptions,
  transactionActive = false,
): CustomAdapter {
  const findRows = async <T>({
    model,
    where: filters,
    select: fields,
    limit,
    offset: skip,
    sortBy,
    join,
  }: {
    model: string
    where?: CleanedWhere[]
    select?: string[]
    limit?: number
    offset?: number
    sortBy?: {
      field: string
      direction: "asc" | "desc"
    }
    join?: JoinConfig
  }) => {
    const target = authSchema.tableFor(model)
    const projection = selection(target, fields)
    const rows = await client.rows(
      select(
        projection as any,
        from(target),
        filters?.length ? where(whereExpression(target, filters)) : omit,
        sortBy
          ? orderBy(
              sortBy.direction === "asc"
                ? asc(column(target, sortBy.field))
                : desc(column(target, sortBy.field)),
            )
          : omit,
        typeof skip === "number" ? offset(skip) : omit,
        typeof limit === "number" ? fetchFirst(limit) : omit,
      ) as any,
    )

    if (!join) {
      return rows as T[]
    }

    return (await Promise.all(
      rows.map(async (row) => {
        const output = { ...row } as Record<string, unknown>

        for (const [joinModel, config] of Object.entries(join)) {
          const joined = authSchema.tableFor(joinModel)
          const joinedRows = await client.rows(
            select(
              selection(joined),
              from(joined),
              where(eq(column(joined, config.on.to), (row as any)[config.on.from])),
              fetchFirst(config.limit ?? 100),
            ) as any,
          )

          output[joinModel] =
            config.relation === "one-to-one" ? (joinedRows[0] ?? null) : joinedRows
        }

        return output
      }),
    )) as unknown as T[]
  }

  return {
    async create({ model, data, select: fields }) {
      const target = authSchema.tableFor(model)

      if (dialect === "mysql") {
        const inserted = await client.execute(
          (insertInto as any)(target, values(mapInsertAssignments(target, data))) as any,
        )
        const id = data.id ?? inserted.insertId

        if (id === undefined) {
          throw new TypeError("@qubu/better-auth could not resolve the inserted MySQL row id.")
        }

        return (
          await findRows({
            model,
            where: [
              {
                field: "id",
                operator: "eq",
                connector: "AND",
                mode: "sensitive",
                value: id,
              },
            ],
            select: fields,
            limit: 1,
          })
        )[0] as any
      }

      const result = await client.rows(
        (insertInto as any)(
          target,
          values(mapInsertAssignments(target, data)),
          returning(selection(target, fields)),
        ) as any,
      )

      return result[0] as any
    },
    async findOne(data) {
      return ((
        await findRows<any>({
          ...data,
          limit: 1,
        })
      )[0] ?? null) as any
    },
    findMany(data) {
      return findRows(data)
    },
    async count({ model, where: filters }) {
      const target = authSchema.tableFor(model)
      const rows = await client.rows(
        select(
          { count: count() },
          from(target),
          filters?.length ? where(whereExpression(target, filters)) : omit,
        ) as any,
      )

      return Number((rows[0] as any)?.count ?? 0)
    },
    async update({ model, where: filters, update: assignments }) {
      if (!filters.length) {
        return null
      }

      return singleMutation(
        client,
        authSchema.tableFor(model),
        filters,
        assignments as any,
        dialect,
        transactionActive,
      ) as any
    },
    async updateMany({ model, where: filters, update: assignments }) {
      const target = authSchema.tableFor(model)
      const result = await client.execute(
        (update as any)(
          target,
          mapAssignments(target, assignments),
          filters.length ? where(whereExpression(target, filters)) : allowAll(),
        ) as any,
      )

      return Number(result.affectedRows ?? result.changedRows ?? 0)
    },
    async delete({ model, where: filters }) {
      if (!filters.length) {
        return
      }

      await consume(client, authSchema.tableFor(model), filters, dialect, transactionActive)
    },
    async deleteMany({ model, where: filters }) {
      const target = authSchema.tableFor(model)
      const result = await client.execute(
        (deleteFrom as any)(
          target,
          filters.length ? where(whereExpression(target, filters)) : allowAll(),
        ) as any,
      )

      return Number(result.affectedRows ?? 0)
    },
    consumeOne({ model, where: filters }) {
      if (!filters.length) {
        return Promise.resolve(null)
      }

      return consume(client, authSchema.tableFor(model), filters, dialect, transactionActive) as any
    },
    incrementOne({ model, where: filters, increment, set }) {
      if (!filters.length) {
        return Promise.resolve(null)
      }

      const target = authSchema.tableFor(model)
      const assignments = { ...set }

      for (const [field, delta] of Object.entries(increment)) {
        assignments[field] = add(column(target, field), delta)
      }

      return singleMutation(client, target, filters, assignments, dialect, transactionActive) as any
    },
    async createSchema({ tables, file }) {
      const generated = betterAuthSchemaFromMetadataSource(tables, dialect, betterAuthOptions)

      return {
        path: file ?? "auth-schema.ts",
        code: generated,
        overwrite: true,
      }
    },
    options: { dialect },
  }
}

async function singleMutation(
  client: QubuClient,
  target: AnyTable,
  filters: CleanedWhere[],
  assignments: Record<string, unknown>,
  dialect: BetterAuthDialect,
  transactionActive: boolean,
) {
  if (dialect !== "mysql") {
    const id = column(target, "id")
    const candidate = select(
      { id },
      from(target),
      where(whereExpression(target, filters)),
      fetchFirst(1),
    )
    const rows = await client.rows(
      update(
        target,
        mapAssignments(target, assignments),
        (where as any)(and(whereExpression(target, filters), inQuery(id, candidate))),
        returning(selection(target)),
      ) as any,
    )

    return rows[0] ?? null
  }

  const mutate = async (scoped: QubuClient) => {
    const row = await lockedRow(scoped, target, filters)

    if (!row) {
      return null
    }

    await scoped.execute(
      update(
        target,
        mapAssignments(target, assignments),
        where(eq(column(target, "id"), row.id as any)),
      ) as any,
    )
    const refreshed = await scoped.rows(
      select(
        selection(target),
        from(target),
        where(eq(column(target, "id"), row.id as any)),
        fetchFirst(1),
      ) as any,
    )

    return refreshed[0] ?? null
  }

  return transactionActive ? mutate(client) : withTransaction(client, mutate)
}

async function consume(
  client: QubuClient,
  target: AnyTable,
  filters: CleanedWhere[],
  dialect: BetterAuthDialect,
  transactionActive: boolean,
) {
  if (dialect !== "mysql") {
    const id = column(target, "id")
    const candidate = select(
      { id },
      from(target),
      where(whereExpression(target, filters)),
      fetchFirst(1),
    )
    const rows = await client.rows(
      deleteFrom(target, where(inQuery(id, candidate)), returning(selection(target))) as any,
    )

    return rows[0] ?? null
  }

  const remove = async (scoped: QubuClient) => {
    const row = await lockedRow(scoped, target, filters)

    if (!row) {
      return null
    }

    await scoped.execute(deleteFrom(target, where(eq(column(target, "id"), row.id as any))) as any)
    return row
  }

  return transactionActive ? remove(client) : withTransaction(client, remove)
}

async function lockedRow(client: QubuClient, target: AnyTable, filters: CleanedWhere[]) {
  const rows = await client.rows(
    select(
      selection(target),
      from(target),
      where(whereExpression(target, filters)),
      fetchFirst(1),
      rowLock(),
    ) as any,
  )

  return rows[0] as Record<string, unknown> | undefined
}

function withTransaction<T>(client: QubuClient, callback: (client: QubuClient) => Promise<T>) {
  if (!("transaction" in client) || typeof client.transaction !== "function") {
    throw new TypeError("@qubu/better-auth atomic operations require transactions.")
  }

  return (client as QubuTransactionalClient).transaction(callback)
}

function selection(target: AnyTable, fields?: string[]) {
  const selected = fields?.length
    ? fields.map((field) => target.sqlNames[field] ?? field)
    : Object.values(target.sqlNames)

  return Object.fromEntries(selected.map((field) => [field, column(target, field)]))
}

function column(target: AnyTable, field: string): any {
  const logicalField =
    Object.entries(target.sqlNames).find(([, sqlName]) => sqlName === field)?.[0] ??
    (field in target.columns ? field : undefined)
  const result = logicalField ? target.columns[logicalField] : undefined

  if (!result) {
    throw new TypeError(`Unknown field ${field} on Better Auth model ${target.tableName}.`)
  }

  return result
}

function mapAssignments(target: AnyTable, input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([field, value]) => {
      const logicalField =
        Object.entries(target.sqlNames).find(([, sqlName]) => sqlName === field)?.[0] ??
        (field in target.columns ? field : undefined)

      if (!logicalField) {
        throw new TypeError(`Unknown field ${field} on Better Auth model ${target.tableName}.`)
      }

      return [logicalField, value]
    }),
  )
}

function mapInsertAssignments(target: AnyTable, input: Record<string, unknown>) {
  const mapped = mapAssignments(target, input)

  for (const [field, definition] of Object.entries(target.definitions)) {
    if (definition.nullable && !(field in mapped)) {
      mapped[field] = null
    }
  }

  return mapped
}

function escapeLikePattern(value: string) {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")
}

function escapedLike(left: any, pattern: string) {
  return sql.type<boolean, SqlBoolean>()`${left} LIKE ${pattern} ESCAPE '!'`
}

function whereExpression(target: AnyTable, filters: CleanedWhere[]): any {
  let expression: any

  for (const filter of filters) {
    const field = column(target, filter.field)
    const insensitive = filter.mode === "insensitive"
    const left = insensitive ? lower(field) : field
    const raw = filter.value
    const value = insensitive
      ? typeof raw === "string"
        ? raw.toLowerCase()
        : Array.isArray(raw)
          ? raw.map((item) => (typeof item === "string" ? item.toLowerCase() : item))
          : raw
      : raw
    const condition = (() => {
      switch (filter.operator) {
        case "eq": {
          return value === null ? isNull(field) : eq(left, value as any)
        }

        case "ne": {
          return value === null ? isNotNull(field) : ne(left, value as any)
        }

        case "lt": {
          return lt(left, value as any)
        }

        case "lte": {
          return lte(left, value as any)
        }

        case "gt": {
          return gt(left, value as any)
        }

        case "gte": {
          return gte(left, value as any)
        }

        case "in": {
          return inList(left, value as any[])
        }

        case "not_in": {
          return notIn(left, value as any[])
        }

        case "contains": {
          return escapedLike(left, `%${escapeLikePattern(String(value))}%`)
        }

        case "starts_with": {
          return escapedLike(left, `${escapeLikePattern(String(value))}%`)
        }

        case "ends_with": {
          return escapedLike(left, `%${escapeLikePattern(String(value))}`)
        }
      }
    })()

    expression = expression
      ? filter.connector === "OR"
        ? or(expression, condition)
        : and(expression, condition)
      : condition
  }

  return expression
}

function assertDialect(dialect: string): BetterAuthDialect {
  if (dialect === "postgresql" || dialect === "mysql" || dialect === "sqlite") {
    return dialect
  }

  throw new TypeError(
    `@qubu/better-auth supports PostgreSQL, MySQL, and SQLite; received ${dialect}.`,
  )
}

function betterAuthSchemaFromMetadataSource(
  tables: unknown,
  dialect: BetterAuthDialect,
  options: BetterAuthOptions,
) {
  const generateId = options.advanced?.database?.generateId
  const schemaOptions =
    generateId === "serial" || generateId === "uuid"
      ? `, { advanced: { database: { generateId: ${JSON.stringify(generateId)} } } }`
      : ""

  return [
    "import { betterAuthSchemaFromTables } from '@qubu/better-auth'",
    "",
    `export const authSchema = betterAuthSchemaFromTables(${serializeMetadata(tables)}, ${JSON.stringify(dialect)}${schemaOptions})`,
    "",
  ].join("\n")
}

function serializeMetadata(value: unknown, indent = 0): string {
  if (typeof value === "function") {
    return "() => undefined"
  }

  if (value === undefined) {
    return "undefined"
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeMetadata(item, indent + 2)).join(", ")}]`
  }

  const entries = Object.entries(value).map(
    ([key, item]) =>
      `${" ".repeat(indent + 2)}${JSON.stringify(key)}: ${serializeMetadata(item, indent + 2)}`,
  )

  return `{\n${entries.join(",\n")}\n${" ".repeat(indent)}}`
}
