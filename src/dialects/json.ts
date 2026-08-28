import type { DialectJson, JsonScalarKind } from "../core/dialect.ts"
import type { AnyFragment, RenderContext } from "../core/fragment.ts"

function jsonPath(path: readonly (string | number)[]) {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : `${result}.${JSON.stringify(segment)}`,
    "$",
  )
}

function appendPath(
  context: RenderContext,
  path: readonly (string | number)[],
  requiredType?: JsonScalarKind,
) {
  context.append("'")
  context.append(jsonPath(path).replaceAll("'", "''"))
  if (requiredType) {
    const type = requiredType === "text" ? "string" : requiredType

    context.append(` ? (@.type() == "${type}")`)
  }

  context.append("'")
}

function renderSqlJsonValue(
  context: RenderContext,
  document: AnyFragment,
  path: readonly (string | number)[],
  returning: string,
  requiredType?: JsonScalarKind,
) {
  context.append("JSON_VALUE(")
  context.render(document)
  context.append(", ")
  appendPath(context, path, requiredType)
  context.append(` RETURNING ${returning} NULL ON EMPTY NULL ON ERROR)`)
}

export const standardJson: DialectJson = {
  renderScalar(context, document, path, kind) {
    const returning =
      kind === "text" ? "VARCHAR(512)" : kind === "number" ? "DOUBLE PRECISION" : "BOOLEAN"

    renderSqlJsonValue(context, document, path, returning, kind)
  },
  renderExists(context, document, path) {
    context.append("COALESCE(JSON_EXISTS(")
    context.render(document)
    context.append(", ")
    appendPath(context, path)
    context.append(" FALSE ON ERROR), FALSE)")
  },
}

function renderPostgresTarget(
  context: RenderContext,
  document: AnyFragment,
  path: readonly (string | number)[],
) {
  context.append("jsonb_path_query_first(CAST(")
  context.render(document)
  context.append(" AS JSONB), ")
  appendPath(context, path)
  context.append(")")
}

function postgresType(kind: JsonScalarKind) {
  return kind === "text" ? "string" : kind
}

export const postgresJson: DialectJson = {
  renderScalar(context, document, path, kind) {
    context.append("(CASE jsonb_typeof(")
    renderPostgresTarget(context, document, path)
    context.append(`) WHEN '${postgresType(kind)}' THEN `)
    if (kind !== "text") {
      context.append("CAST(")
    }

    context.append("(")
    renderPostgresTarget(context, document, path)
    context.append(" #>> '{}')")
    if (kind !== "text") {
      context.append(kind === "number" ? " AS DOUBLE PRECISION)" : " AS BOOLEAN)")
    }

    context.append(" END)")
  },
  renderExists(context, document, path) {
    context.append("COALESCE(jsonb_path_exists(CAST(")
    context.render(document)
    context.append(" AS JSONB), ")
    appendPath(context, path)
    context.append(", '{}'::JSONB, TRUE), FALSE)")
  },
}

function renderMySqlExtract(
  context: RenderContext,
  document: AnyFragment,
  path: readonly (string | number)[],
) {
  context.append("JSON_EXTRACT(")
  context.render(document)
  context.append(", ")
  appendPath(context, path)
  context.append(")")
}

function mysqlType(kind: JsonScalarKind) {
  return kind === "text" ? "STRING" : kind === "number" ? "INTEGER" : "BOOLEAN"
}

export const mysqlJson: DialectJson = {
  renderScalar(context, document, path, kind) {
    context.append("(CASE JSON_TYPE(")
    renderMySqlExtract(context, document, path)
    context.append(`) WHEN '${mysqlType(kind)}' THEN `)
    if (kind === "boolean") {
      context.append("(")
    }

    renderSqlJsonValue(
      context,
      document,
      path,
      kind === "text" ? "CHAR" : kind === "number" ? "DOUBLE" : "CHAR",
    )
    if (kind === "boolean") {
      context.append(" = 'true')")
    }

    context.append(" END)")
  },
  renderExists(context, document, path) {
    context.append("COALESCE(JSON_CONTAINS_PATH(")
    context.render(document)
    context.append(", 'one', ")
    appendPath(context, path)
    context.append("), FALSE)")
  },
}

function renderSqliteExtract(
  context: RenderContext,
  document: AnyFragment,
  path: readonly (string | number)[],
) {
  context.append("json_extract(")
  context.render(document)
  context.append(", ")
  appendPath(context, path)
  context.append(")")
}

function renderSqliteType(
  context: RenderContext,
  document: AnyFragment,
  path: readonly (string | number)[],
) {
  context.append("json_type(")
  context.render(document)
  context.append(", ")
  appendPath(context, path)
  context.append(")")
}

export const sqliteJson: DialectJson = {
  renderScalar(context, document, path, kind) {
    context.append("(CASE ")
    renderSqliteType(context, document, path)
    if (kind === "text") {
      context.append(" WHEN 'text' THEN ")
      renderSqliteExtract(context, document, path)
    } else if (kind === "number") {
      context.append(" WHEN 'integer' THEN ")
      renderSqliteExtract(context, document, path)
      context.append(" WHEN 'real' THEN ")
      renderSqliteExtract(context, document, path)
    } else {
      context.append(" WHEN 'true' THEN TRUE WHEN 'false' THEN FALSE")
    }

    context.append(" END)")
  },
  renderExists(context, document, path) {
    context.append("(")
    renderSqliteType(context, document, path)
    context.append(" IS NOT NULL)")
  },
}
