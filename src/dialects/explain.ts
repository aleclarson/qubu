import type { DialectExplain, ExplainFormat, ExplainRenderOptions } from "../core/dialect.ts"
import { queryValidationError } from "../query/errors.ts"
import type { QueryKind } from "../query/types.ts"

const readQueryKinds = new Set<QueryKind>(["select", "set"])

export function assertExplainAnalysisAllowed(
  dialect: string,
  queryKind: QueryKind,
  options: ExplainRenderOptions,
): void {
  if (options.analyze !== true || readQueryKinds.has(queryKind)) {
    return
  }

  throwExplainError(
    "invalid-explain-query",
    dialect,
    ["analyze"],
    `EXPLAIN ANALYZE is only available for read queries; received ${queryKind}`,
    "Remove analyze for a plan-only mutation EXPLAIN.",
  )
}

export function assertSupportedExplainOptions(
  dialect: string,
  options: ExplainRenderOptions,
  supported: readonly (keyof ExplainRenderOptions)[],
): void {
  for (const option of explainOptionNames) {
    if (options[option] === undefined || supported.includes(option)) {
      continue
    }

    throwExplainError(
      "unsupported-explain-option",
      dialect,
      [option],
      `The ${dialect} EXPLAIN policy does not support the "${option}" option`,
      `Remove ${option} or use a dialect that supports it.`,
    )
  }
}

export function assertBooleanExplainOption(
  dialect: string,
  option: keyof ExplainRenderOptions,
  value: unknown,
): asserts value is boolean | undefined {
  if (value === undefined || typeof value === "boolean") {
    return
  }

  throwExplainError(
    "invalid-explain-options",
    dialect,
    [option],
    `The ${dialect} EXPLAIN option "${option}" must be boolean`,
    `Set ${option} to true or false.`,
  )
}

export function unsupportedExplainFormat(
  dialect: string,
  format: unknown,
  supported: readonly ExplainFormat[],
): never {
  throwExplainError(
    "unsupported-explain-option",
    dialect,
    ["format"],
    `The ${dialect} EXPLAIN policy does not support the "${String(format)}" format`,
    `Use one of: ${supported.join(", ")}.`,
  )
}

export function invalidExplainCombination(
  dialect: string,
  path: readonly (string | number)[],
  message: string,
  hint: string,
): never {
  throwExplainError("invalid-explain-options", dialect, path, message, hint)
}

export const postgresExplain: DialectExplain = {
  render(statement, queryKind, options) {
    assertExplainAnalysisAllowed("PostgreSQL", queryKind, options)
    assertSupportedExplainOptions("PostgreSQL", options, [
      "analyze",
      "verbose",
      "buffers",
      "format",
    ])
    assertBooleanExplainOption("PostgreSQL", "analyze", options.analyze)
    assertBooleanExplainOption("PostgreSQL", "verbose", options.verbose)
    assertBooleanExplainOption("PostgreSQL", "buffers", options.buffers)

    const format = options.format

    if (
      format !== undefined &&
      !postgresExplainFormats.includes(format as (typeof postgresExplainFormats)[number])
    ) {
      unsupportedExplainFormat("PostgreSQL", format, postgresExplainFormats)
    }

    if (options.buffers === true && options.analyze !== true) {
      invalidExplainCombination(
        "PostgreSQL",
        ["buffers"],
        "PostgreSQL EXPLAIN BUFFERS requires ANALYZE",
        "Set analyze: true for a read query, or remove buffers.",
      )
    }

    const clauses = [
      options.analyze === true ? "ANALYZE" : undefined,
      options.verbose === true ? "VERBOSE" : undefined,
      options.buffers === true ? "BUFFERS" : undefined,
      format === undefined ? undefined : `FORMAT ${String(format).toUpperCase()}`,
    ].filter((value): value is string => value !== undefined)

    return `EXPLAIN${clauses.length === 0 ? "" : ` (${clauses.join(", ")})`} ${statement}`
  },
}

export const sqliteExplain: DialectExplain = {
  render(statement, queryKind, options) {
    assertExplainAnalysisAllowed("SQLite", queryKind, options)
    assertSupportedExplainOptions("SQLite", options, ["format", "queryPlan"])
    assertBooleanExplainOption("SQLite", "queryPlan", options.queryPlan)

    const format = options.format

    if (
      format !== undefined &&
      !sqliteExplainFormats.includes(format as (typeof sqliteExplainFormats)[number])
    ) {
      unsupportedExplainFormat("SQLite", format, sqliteExplainFormats)
    }

    const formatIsQueryPlan = format === "query-plan"
    const formatIsBytecode = format === "bytecode"

    if (formatIsQueryPlan && options.queryPlan === false) {
      invalidExplainCombination(
        "SQLite",
        ["format", "queryPlan"],
        'SQLite EXPLAIN format "query-plan" conflicts with queryPlan: false',
        "Choose query-plan or bytecode mode, not both.",
      )
    }

    if (formatIsBytecode && options.queryPlan === true) {
      invalidExplainCombination(
        "SQLite",
        ["format", "queryPlan"],
        'SQLite EXPLAIN format "bytecode" conflicts with queryPlan: true',
        "Choose query-plan or bytecode mode, not both.",
      )
    }

    const queryPlan = formatIsQueryPlan || (!formatIsBytecode && options.queryPlan !== false)

    return `${queryPlan ? "EXPLAIN QUERY PLAN" : "EXPLAIN"} ${statement}`
  },
}

export const mysqlExplain: DialectExplain = {
  render(statement, queryKind, options) {
    assertExplainAnalysisAllowed("MySQL", queryKind, options)
    assertSupportedExplainOptions("MySQL", options, ["analyze", "format"])
    assertBooleanExplainOption("MySQL", "analyze", options.analyze)

    const format = options.format

    if (
      format !== undefined &&
      !mysqlExplainFormats.includes(format as (typeof mysqlExplainFormats)[number])
    ) {
      unsupportedExplainFormat("MySQL", format, mysqlExplainFormats)
    }

    if (options.analyze === true && format !== undefined) {
      invalidExplainCombination(
        "MySQL",
        ["analyze", "format"],
        "MySQL EXPLAIN ANALYZE cannot be combined with FORMAT",
        "Use analyze for the tree analyzer output, or choose a FORMAT without analyze.",
      )
    }

    if (options.analyze === true) {
      return `EXPLAIN ANALYZE ${statement}`
    }

    if (format === undefined) {
      return `EXPLAIN ${statement}`
    }

    return `EXPLAIN FORMAT=${String(format).toUpperCase()} ${statement}`
  },
}

const explainOptionNames = [
  "analyze",
  "verbose",
  "buffers",
  "format",
  "queryPlan",
] as const satisfies readonly (keyof ExplainRenderOptions)[]

const postgresExplainFormats = ["text", "xml", "json", "yaml"] as const
const sqliteExplainFormats = ["query-plan", "bytecode"] as const
const mysqlExplainFormats = ["traditional", "json", "tree"] as const

function throwExplainError(
  code: "invalid-explain-query" | "invalid-explain-options" | "unsupported-explain-option",
  dialect: string,
  path: readonly (string | number)[],
  message: string,
  hint: string,
): never {
  throw queryValidationError({
    code,
    context: `dialect.${dialect.toLowerCase()}.explain`,
    path,
    message,
    hint,
  })
}
