import {
  schemaSnapshotDialectVersion,
  schemaSnapshotFormat,
  schemaSnapshotNamingPolicyVersion,
  schemaSnapshotVersion,
  type SchemaSnapshot,
  type SchemaSnapshotInput,
  type SnapshotCheckConstraint,
  type SnapshotColumn,
  type SnapshotConstraint,
  type SnapshotDecodeResult,
  type SnapshotDefault,
  type SnapshotDialect,
  type SnapshotDialectExtension,
  type SnapshotExpression,
  type SnapshotForeignKey,
  type SnapshotGeneratedColumn,
  type SnapshotIdentity,
  type SnapshotIndex,
  type SnapshotIndexTerm,
  type SnapshotIndexTermExpression,
  type SnapshotJsonValue,
  type SnapshotKeyConstraint,
  type SnapshotLiteral,
  type SnapshotNamingPolicy,
  type SnapshotStorage,
  type SnapshotTable,
  type SnapshotUniqueConstraint,
  type SnapshotDiagnostic,
} from "./types.ts"

/** Error raised by throwing snapshot APIs after collecting diagnostics. */
export class SnapshotValidationError extends TypeError {
  readonly name: string
  readonly diagnostics: readonly SnapshotDiagnostic[]
  readonly issues: readonly SnapshotDiagnostic[]

  constructor(diagnostics: readonly SnapshotDiagnostic[]) {
    const frozen = Object.freeze(
      diagnostics.map((diagnostic) =>
        Object.freeze({
          ...diagnostic,
          path: Object.freeze([...diagnostic.path]),
          relatedPaths: diagnostic.relatedPaths
            ? Object.freeze(diagnostic.relatedPaths.map((path) => Object.freeze([...path])))
            : undefined,
        }),
      ),
    )

    super(frozen.map((diagnostic) => diagnostic.message).join("\n"))
    this.name = "SnapshotValidationError"
    this.diagnostics = frozen
    this.issues = frozen
  }
}

/** Decode and strictly validate a JSON string or parsed snapshot value. */
export function decodeSchemaSnapshot(input: string | unknown): SnapshotDecodeResult {
  let value: unknown = input
  const diagnostics: SnapshotDiagnostic[] = []

  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "invalid-snapshot",
            `Snapshot JSON could not be parsed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            [],
          ),
        ],
      }
    }
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [diagnostic("invalid-snapshot", "Snapshot root must be an object", [])],
    }
  }

  const snapshot = validateSnapshot(value, diagnostics)

  if (diagnostics.length > 0 || snapshot === undefined) {
    return {
      ok: false,
      diagnostics: Object.freeze(diagnostics),
    }
  }

  return {
    ok: true,
    value: freezeSnapshot(snapshot),
  }
}

/** Validate a snapshot and throw one structured error if it is malformed. */
export function assertSchemaSnapshot(input: SchemaSnapshotInput | string): SchemaSnapshot {
  const result = decodeSchemaSnapshot(input)

  if (!result.ok) {
    throw new SnapshotValidationError(result.diagnostics)
  }

  return result.value
}

/** Return a fixed-order, deeply immutable copy of a valid snapshot. */
export function canonicalizeSchemaSnapshot(input: SchemaSnapshotInput): SchemaSnapshot {
  return assertSchemaSnapshot(input)
}

function validateSnapshot(
  value: Record<string, unknown>,
  diagnostics: SnapshotDiagnostic[],
): SchemaSnapshot | undefined {
  requireKeys(
    value,
    ["format", "version", "dialect", "namingPolicy", "namespace", "tables"],
    [],
    diagnostics,
    ["namespace"],
  )

  if (value.format !== schemaSnapshotFormat) {
    diagnostics.push(
      diagnostic("invalid-snapshot", `Snapshot format must be "${schemaSnapshotFormat}"`, [
        "format",
      ]),
    )
  }

  if (value.version !== schemaSnapshotVersion) {
    diagnostics.push(
      diagnostic(
        typeof value.version === "number" && value.version > schemaSnapshotVersion
          ? "future-version"
          : "invalid-snapshot",
        `Unsupported schema snapshot version: ${String(value.version)}`,
        ["version"],
      ),
    )
  }

  const dialect = validateDialect(value.dialect, ["dialect"], diagnostics)
  const namingPolicy = validateNamingPolicy(value.namingPolicy, ["namingPolicy"], diagnostics)

  if (value.namespace !== undefined) {
    if (
      typeof value.namespace !== "string" ||
      value.namespace.length === 0 ||
      value.namespace !== value.namespace.trim() ||
      /[.\\/\u0000-\u001f\u007f"']/u.test(value.namespace)
    ) {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Snapshot namespace must be a non-empty identifier", [
          "namespace",
        ]),
      )
    }
  }

  const tablesValue = value.tables
  const tables: SnapshotTable[] = []

  if (!Array.isArray(tablesValue)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Snapshot tables must be an array", ["tables"]))
  } else {
    validateSortedIds(tablesValue, ["tables"], diagnostics)
    for (const [index, table] of tablesValue.entries()) {
      const validated = validateTable(table, ["tables", index], dialect?.name, diagnostics)

      if (validated !== undefined) {
        tables.push(validated)
      }
    }
  }

  if (dialect === undefined || namingPolicy === undefined) {
    return undefined
  }

  validateCrossReferences(tables, diagnostics)

  const snapshot: SchemaSnapshot = {
    format: schemaSnapshotFormat,
    version: schemaSnapshotVersion,
    dialect,
    namingPolicy,
    ...(value.namespace !== undefined ? { namespace: value.namespace as string } : {}),
    tables,
  }

  return snapshot
}

function validateDialect(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): SnapshotDialect | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Dialect must be an object", path))
    return undefined
  }

  requireKeys(value, ["name", "version"], path, diagnostics)
  if (typeof value.name !== "string" || value.name.length === 0) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Dialect name must be non-empty", [...path, "name"]),
    )
  }

  if (
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Dialect version must be a positive integer", [
        ...path,
        "version",
      ]),
    )
  } else if (value.version > schemaSnapshotDialectVersion) {
    diagnostics.push(
      diagnostic("future-version", `Unsupported dialect extension version: ${value.version}`, [
        ...path,
        "version",
      ]),
    )
  }

  if (typeof value.name !== "string" || typeof value.version !== "number") {
    return undefined
  }

  return {
    name: value.name,
    version: value.version,
  }
}

function validateNamingPolicy(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): SnapshotNamingPolicy | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Naming policy must be an object", path))
    return undefined
  }

  requireKeys(value, ["name", "version"], path, diagnostics)
  if (typeof value.name !== "string" || value.name.length === 0) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Naming-policy name must be non-empty", [...path, "name"]),
    )
  }

  if (value.version !== schemaSnapshotNamingPolicyVersion) {
    diagnostics.push(
      diagnostic(
        typeof value.version === "number" && value.version > schemaSnapshotNamingPolicyVersion
          ? "future-version"
          : "invalid-snapshot",
        `Unsupported naming-policy version: ${String(value.version)}`,
        [...path, "version"],
      ),
    )
  }

  if (typeof value.name !== "string" || typeof value.version !== "number") {
    return undefined
  }

  return {
    name: value.name,
    version: value.version,
  }
}

function validateTable(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotTable | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Table must be an object", path))
    return undefined
  }

  requireKeys(value, ["id", "physicalName", "columns", "constraints", "indexes"], path, diagnostics)
  const id = validateId(value.id, [...path, "id"], diagnostics)
  const physicalName = validateName(value.physicalName, [...path, "physicalName"], diagnostics)
  const columns = validateArray<SnapshotColumn>(
    value.columns,
    [...path, "columns"],
    diagnostics,
    (item, itemPath) => validateColumn(item, itemPath, dialect, diagnostics),
  )
  const constraints = validateArray<SnapshotConstraint>(
    value.constraints,
    [...path, "constraints"],
    diagnostics,
    (item, itemPath) => validateConstraint(item, itemPath, dialect, diagnostics),
  )
  const indexes = validateArray<SnapshotIndex>(
    value.indexes,
    [...path, "indexes"],
    diagnostics,
    (item, itemPath) => validateIndex(item, itemPath, dialect, diagnostics),
  )

  validateSortedIds(value.columns, [...path, "columns"], diagnostics)
  validateSortedIds(value.constraints, [...path, "constraints"], diagnostics)
  validateSortedIds(value.indexes, [...path, "indexes"], diagnostics)
  if (
    id === undefined ||
    physicalName === undefined ||
    columns === undefined ||
    constraints === undefined ||
    indexes === undefined
  ) {
    return undefined
  }

  return {
    id,
    physicalName,
    columns,
    constraints,
    indexes,
  }
}

function validateColumn(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotColumn | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Column must be an object", path))
    return undefined
  }

  requireKeys(
    value,
    [
      "id",
      "physicalName",
      "nullable",
      "hasDefault",
      "generated",
      "storage",
      "default",
      "generatedColumn",
      "identity",
      "onUpdate",
    ],
    path,
    diagnostics,
    ["storage", "default", "generatedColumn", "identity", "onUpdate"],
  )
  const id = validateId(value.id, [...path, "id"], diagnostics)
  const physicalName = validateName(value.physicalName, [...path, "physicalName"], diagnostics)
  const nullable = validateBoolean(value.nullable, [...path, "nullable"], diagnostics)
  const hasDefault = validateBoolean(value.hasDefault, [...path, "hasDefault"], diagnostics)
  const generated = validateBoolean(value.generated, [...path, "generated"], diagnostics)
  const storage =
    value.storage === undefined
      ? undefined
      : validateStorage(value.storage, [...path, "storage"], dialect, diagnostics)
  const defaultValue =
    value.default === undefined
      ? undefined
      : validateDefault(value.default, [...path, "default"], dialect, diagnostics)
  const generatedColumn =
    value.generatedColumn === undefined
      ? undefined
      : validateGenerated(value.generatedColumn, [...path, "generatedColumn"], dialect, diagnostics)
  const identity =
    value.identity === undefined
      ? undefined
      : validateIdentity(value.identity, [...path, "identity"], dialect, diagnostics)
  const onUpdate =
    value.onUpdate === undefined
      ? undefined
      : validateExpression(value.onUpdate, [...path, "onUpdate"], "default", dialect, diagnostics)

  if (onUpdate !== undefined && dialect !== "mysql") {
    diagnostics.push(
      diagnostic("dialect-mismatch", "Column onUpdate metadata is only valid for MySQL snapshots", [
        ...path,
        "onUpdate",
      ]),
    )
  }

  if (
    id === undefined ||
    physicalName === undefined ||
    nullable === undefined ||
    hasDefault === undefined ||
    generated === undefined
  ) {
    return undefined
  }

  return {
    id,
    physicalName,
    nullable,
    hasDefault,
    generated,
    ...(storage === undefined ? {} : { storage }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(generatedColumn === undefined ? {} : { generatedColumn }),
    ...(identity === undefined ? {} : { identity }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
  }
}

function validateStorage(
  value: unknown,
  path: readonly (string | number)[],
  snapshotDialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotStorage | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Storage must be an object", path))
    return undefined
  }

  if (value.kind === "portable") {
    requireKeys(value, ["kind", "type"], path, diagnostics)
    const type = validateName(value.type, [...path, "type"], diagnostics)

    return type === undefined
      ? undefined
      : {
          kind: "portable",
          type,
        }
  }

  if (value.kind === "native") {
    requireKeys(value, ["kind", "dialect", "type", "affinity"], path, diagnostics, ["affinity"])
    const storageDialect = validateName(value.dialect, [...path, "dialect"], diagnostics)
    const type = validateName(value.type, [...path, "type"], diagnostics)

    if (
      snapshotDialect !== undefined &&
      storageDialect !== undefined &&
      storageDialect !== snapshotDialect
    ) {
      diagnostics.push(
        diagnostic(
          "dialect-mismatch",
          `Native storage belongs to "${storageDialect}" but snapshot dialect is "${snapshotDialect}"`,
          [...path, "dialect"],
        ),
      )
    }

    const affinityValue = value.affinity
    const affinity =
      affinityValue === undefined ||
      affinityValue === "blob" ||
      affinityValue === "integer" ||
      affinityValue === "numeric" ||
      affinityValue === "real" ||
      affinityValue === "text"
        ? affinityValue
        : undefined

    if (affinityValue !== undefined && affinity === undefined) {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Storage affinity is invalid", [...path, "affinity"]),
      )
    }

    if (affinity !== undefined && snapshotDialect !== "sqlite") {
      diagnostics.push(
        diagnostic("dialect-mismatch", "Storage affinity is only valid for SQLite snapshots", [
          ...path,
          "affinity",
        ]),
      )
    }

    return storageDialect === undefined || type === undefined
      ? undefined
      : {
          kind: "native",
          dialect: storageDialect,
          type,
          ...(affinity === undefined ? {} : { affinity }),
        }
  }

  diagnostics.push(
    diagnostic("invalid-snapshot", "Storage kind must be portable or native", [...path, "kind"]),
  )
  return undefined
}

function validateDefault(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotDefault | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Default must be an object", path))
    return undefined
  }

  if (value.kind === "external") {
    requireKeys(value, ["kind"], path, diagnostics)
    return { kind: "external" }
  }

  if (value.kind === "literal") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    const literal = validateLiteral(value.value, [...path, "value"], diagnostics)

    return literal === undefined
      ? undefined
      : {
          kind: "literal",
          value: literal,
        }
  }

  if (value.kind === "expression") {
    requireKeys(value, ["kind", "expression"], path, diagnostics)
    const expression = validateExpression(
      value.expression,
      [...path, "expression"],
      "default",
      dialect,
      diagnostics,
    )

    return expression === undefined
      ? undefined
      : {
          kind: "expression",
          expression,
        }
  }

  diagnostics.push(diagnostic("invalid-snapshot", "Default kind is invalid", [...path, "kind"]))
  return undefined
}

function validateGenerated(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotGeneratedColumn | undefined {
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Generated-column metadata must be an object", path),
    )
    return undefined
  }

  if (value.kind === "external") {
    requireKeys(value, ["kind"], path, diagnostics)
    return { kind: "external" }
  }

  if (value.kind === "expression") {
    requireKeys(value, ["kind", "expression", "mode"], path, diagnostics)
    const expression = validateExpression(
      value.expression,
      [...path, "expression"],
      "generated",
      dialect,
      diagnostics,
    )
    const mode = value.mode === "stored" || value.mode === "virtual" ? value.mode : undefined

    if (mode === undefined) {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Generated-column mode must be stored or virtual", [
          ...path,
          "mode",
        ]),
      )
    }

    return expression === undefined || mode === undefined
      ? undefined
      : {
          kind: "expression",
          expression,
          mode,
        }
  }

  diagnostics.push(
    diagnostic("invalid-snapshot", "Generated-column kind is invalid", [...path, "kind"]),
  )
  return undefined
}

function validateIdentity(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotIdentity | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Identity must be an object", path))
    return undefined
  }

  requireKeys(value, ["kind", "generation", "dialect"], path, diagnostics, ["dialect"])
  if (value.kind !== "identity") {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Identity kind must be identity", [...path, "kind"]),
    )
  }

  if (value.generation !== "always" && value.generation !== "by-default") {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Identity generation is invalid", [...path, "generation"]),
    )
  }

  if (
    value.kind !== "identity" ||
    (value.generation !== "always" && value.generation !== "by-default")
  ) {
    return undefined
  }

  const extension = validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)

  return {
    kind: "identity",
    generation: value.generation,
    ...(extension === undefined ? {} : { dialect: extension }),
  }
}

function validateConstraint(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotConstraint | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Constraint must be an object", path))
    return undefined
  }

  const common = validateConstraintCommon(value, path, diagnostics)

  if (common === undefined) {
    return undefined
  }

  if (value.kind === "primary-key" || value.kind === "unique") {
    requireKeys(
      value,
      ["id", "kind", "physicalName", "columns", "deferrable", "initially", "dialect"],
      path,
      diagnostics,
      ["deferrable", "initially", "dialect"],
    )
    const columns = validateColumnIds(value.columns, [...path, "columns"], diagnostics)
    const extra = validateConstraintTiming(value, path, diagnostics)
    const extension = validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)

    if (columns === undefined || extra === undefined) {
      return undefined
    }

    return {
      ...common,
      kind: value.kind,
      columns,
      ...extra,
      ...(extension === undefined ? {} : { dialect: extension }),
    } as SnapshotKeyConstraint
  }

  if (value.kind === "unique-constraint") {
    requireKeys(
      value,
      ["id", "kind", "physicalName", "columns", "nulls", "deferrable", "initially", "dialect"],
      path,
      diagnostics,
      ["deferrable", "initially", "dialect"],
    )
    const columns = validateColumnIds(value.columns, [...path, "columns"], diagnostics)
    const extra = validateConstraintTiming(value, path, diagnostics)
    const extension = validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)

    if (value.nulls !== "distinct" && value.nulls !== "not-distinct") {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Unique-constraint null semantics are invalid", [
          ...path,
          "nulls",
        ]),
      )
    }

    if (
      columns === undefined ||
      extra === undefined ||
      (value.nulls !== "distinct" && value.nulls !== "not-distinct")
    ) {
      return undefined
    }

    return {
      ...common,
      kind: "unique-constraint",
      columns,
      nulls: value.nulls,
      ...extra,
      ...(extension === undefined ? {} : { dialect: extension }),
    } as SnapshotUniqueConstraint
  }

  if (value.kind === "foreign-key") {
    requireKeys(
      value,
      [
        "id",
        "kind",
        "physicalName",
        "columns",
        "target",
        "onUpdate",
        "onDelete",
        "match",
        "deferrable",
        "initially",
        "dialect",
      ],
      path,
      diagnostics,
      ["onUpdate", "onDelete", "match", "deferrable", "initially", "dialect"],
    )
    const columns = validateColumnIds(value.columns, [...path, "columns"], diagnostics)
    const target = validateForeignKeyTarget(value.target, [...path, "target"], diagnostics)
    const extra = validateForeignKeyOptions(value, path, diagnostics)
    const extension = validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)

    if (columns === undefined || target === undefined || extra === undefined) {
      return undefined
    }

    return {
      ...common,
      kind: "foreign-key",
      columns,
      target,
      ...extra,
      ...(extension === undefined ? {} : { dialect: extension }),
    } as SnapshotForeignKey
  }

  if (value.kind === "check") {
    requireKeys(
      value,
      ["id", "kind", "physicalName", "expression", "deferrable", "initially", "dialect"],
      path,
      diagnostics,
      ["deferrable", "initially", "dialect"],
    )
    const expression = validateExpression(
      value.expression,
      [...path, "expression"],
      "check",
      dialect,
      diagnostics,
    )
    const extra = validateConstraintTiming(value, path, diagnostics)
    const extension = validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)

    if (expression === undefined || extra === undefined) {
      return undefined
    }

    return {
      ...common,
      kind: "check",
      expression,
      ...extra,
      ...(extension === undefined ? {} : { dialect: extension }),
    } as SnapshotCheckConstraint
  }

  diagnostics.push(
    diagnostic("invalid-snapshot", `Unknown constraint kind: ${String(value.kind)}`, [
      ...path,
      "kind",
    ]),
  )
  return undefined
}

function validateConstraintCommon(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
):
  | {
      id: string
      kind: SnapshotConstraint["kind"]
      physicalName: string
    }
  | undefined {
  const id = validateId(value.id, [...path, "id"], diagnostics)
  const physicalName = validateName(value.physicalName, [...path, "physicalName"], diagnostics)

  if (id === undefined || physicalName === undefined) {
    return undefined
  }

  return {
    id,
    kind: value.kind as SnapshotConstraint["kind"],
    physicalName,
  }
}

function validateConstraintTiming(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
):
  | {
      deferrable?: boolean
      initially?: "immediate" | "deferred"
    }
  | undefined {
  const deferrable = validateOptionalBoolean(value.deferrable, [...path, "deferrable"], diagnostics)
  const initially =
    value.initially === undefined
      ? undefined
      : value.initially === "immediate" || value.initially === "deferred"
        ? value.initially
        : undefined

  if (value.initially !== undefined && initially === undefined) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Constraint timing is invalid", [...path, "initially"]),
    )
  }

  if (deferrable === undefined && value.deferrable !== undefined) {
    return undefined
  }

  if (value.initially !== undefined && initially === undefined) {
    return undefined
  }

  return {
    ...(deferrable === undefined ? {} : { deferrable }),
    ...(initially === undefined ? {} : { initially }),
  }
}

function validateForeignKeyOptions(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
):
  | {
      onUpdate?: SnapshotForeignKey["onUpdate"]
      onDelete?: SnapshotForeignKey["onDelete"]
      match?: SnapshotForeignKey["match"]
      deferrable?: boolean
      initially?: "immediate" | "deferred"
    }
  | undefined {
  const action = (key: "onUpdate" | "onDelete") => {
    const candidate = value[key]

    if (candidate === undefined) {
      return undefined
    }

    if (
      candidate === "no-action" ||
      candidate === "restrict" ||
      candidate === "cascade" ||
      candidate === "set-null" ||
      candidate === "set-default"
    ) {
      return candidate
    }

    diagnostics.push(
      diagnostic("invalid-snapshot", `Foreign-key ${key} action is invalid`, [...path, key]),
    )
    return undefined
  }

  const onUpdate = action("onUpdate")
  const onDelete = action("onDelete")
  const match =
    value.match === undefined
      ? undefined
      : value.match === "simple" || value.match === "full" || value.match === "partial"
        ? value.match
        : undefined

  if (value.match !== undefined && match === undefined) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Foreign-key match mode is invalid", [...path, "match"]),
    )
  }

  const timing = validateConstraintTiming(value, path, diagnostics)

  if (
    timing === undefined ||
    (value.onUpdate !== undefined && onUpdate === undefined) ||
    (value.onDelete !== undefined && onDelete === undefined) ||
    (value.match !== undefined && match === undefined)
  ) {
    return undefined
  }

  return {
    ...(onUpdate === undefined ? {} : { onUpdate }),
    ...(onDelete === undefined ? {} : { onDelete }),
    ...(match === undefined ? {} : { match }),
    ...timing,
  }
}

function validateForeignKeyTarget(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): SnapshotForeignKey["target"] | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Foreign-key target must be an object", path))
    return undefined
  }

  requireKeys(value, ["table", "columns"], path, diagnostics)
  const table = validateId(value.table, [...path, "table"], diagnostics)
  const columns = validateColumnIds(value.columns, [...path, "columns"], diagnostics)

  return table === undefined || columns === undefined
    ? undefined
    : {
        table,
        columns,
      }
}

function validateIndex(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotIndex | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Index must be an object", path))
    return undefined
  }

  requireKeys(
    value,
    [
      "id",
      "kind",
      "physicalName",
      "terms",
      "unique",
      "candidateKey",
      "predicate",
      "includedColumns",
      "dialect",
    ],
    path,
    diagnostics,
    ["predicate", "includedColumns", "dialect"],
  )
  const id = validateId(value.id, [...path, "id"], diagnostics)
  const physicalName = validateName(value.physicalName, [...path, "physicalName"], diagnostics)

  if (value.kind !== "index") {
    diagnostics.push(diagnostic("invalid-snapshot", "Index kind must be index", [...path, "kind"]))
  }

  const unique = validateBoolean(value.unique, [...path, "unique"], diagnostics)
  const candidateKey = validateBoolean(value.candidateKey, [...path, "candidateKey"], diagnostics)
  const terms = validateArray<SnapshotIndexTerm>(
    value.terms,
    [...path, "terms"],
    diagnostics,
    (item, itemPath) => validateIndexTerm(item, itemPath, dialect, diagnostics),
  )
  const predicate =
    value.predicate === undefined
      ? undefined
      : validateExpression(value.predicate, [...path, "predicate"], "index", dialect, diagnostics)
  const includedColumns =
    value.includedColumns === undefined
      ? undefined
      : validateColumnIds(value.includedColumns, [...path, "includedColumns"], diagnostics)
  const extension = validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)

  if (
    id === undefined ||
    physicalName === undefined ||
    unique === undefined ||
    candidateKey === undefined ||
    terms === undefined ||
    value.kind !== "index" ||
    terms.length === 0
  ) {
    return undefined
  }

  return {
    id,
    kind: "index",
    physicalName,
    terms,
    unique,
    candidateKey,
    ...(predicate === undefined ? {} : { predicate }),
    ...(includedColumns === undefined ? {} : { includedColumns }),
    ...(extension === undefined ? {} : { dialect: extension }),
  }
}

function validateIndexTerm(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotIndexTerm | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Index term must be an object", path))
    return undefined
  }

  if (value.kind === "column") {
    requireKeys(value, ["kind", "column"], path, diagnostics)
    const column = validateId(value.column, [...path, "column"], diagnostics)

    return column === undefined
      ? undefined
      : {
          kind: "column",
          column,
        }
  }

  if (value.kind === "expression") {
    requireKeys(value, ["kind", "expression"], path, diagnostics)
    const expression = validateExpression(
      value.expression,
      [...path, "expression"],
      "index",
      dialect,
      diagnostics,
    )

    return expression === undefined
      ? undefined
      : {
          kind: "expression",
          expression,
        }
  }

  if (value.kind === "order") {
    requireKeys(value, ["kind", "expression", "direction", "nulls"], path, diagnostics, [
      "direction",
      "nulls",
    ])
    const expression = validateIndexTermExpression(
      value.expression,
      [...path, "expression"],
      dialect,
      diagnostics,
    )
    const direction =
      value.direction === undefined
        ? undefined
        : value.direction === "ASC" || value.direction === "DESC"
          ? value.direction
          : undefined
    const nulls =
      value.nulls === undefined
        ? undefined
        : value.nulls === "FIRST" || value.nulls === "LAST"
          ? value.nulls
          : undefined

    if (value.direction !== undefined && direction === undefined) {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Index order direction is invalid", [...path, "direction"]),
      )
    }

    if (value.nulls !== undefined && nulls === undefined) {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Index NULL ordering is invalid", [...path, "nulls"]),
      )
    }

    if (
      expression === undefined ||
      (value.direction !== undefined && direction === undefined) ||
      (value.nulls !== undefined && nulls === undefined)
    ) {
      return undefined
    }

    return {
      kind: "order",
      expression,
      ...(direction === undefined ? {} : { direction }),
      ...(nulls === undefined ? {} : { nulls }),
    }
  }

  diagnostics.push(diagnostic("invalid-snapshot", "Index term kind is invalid", [...path, "kind"]))
  return undefined
}

function validateIndexTermExpression(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotIndexTermExpression | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Index expression must be an object", path))
    return undefined
  }

  if (value.kind === "column") {
    requireKeys(value, ["kind", "column"], path, diagnostics)
    const column = validateId(value.column, [...path, "column"], diagnostics)

    return column === undefined
      ? undefined
      : {
          kind: "column",
          column,
        }
  }

  if (value.kind === "expression") {
    requireKeys(value, ["kind", "expression"], path, diagnostics)
    const expression = validateExpression(
      value.expression,
      [...path, "expression"],
      "index",
      dialect,
      diagnostics,
    )

    return expression === undefined
      ? undefined
      : {
          kind: "expression",
          expression,
        }
  }

  diagnostics.push(
    diagnostic("invalid-snapshot", "Index expression kind is invalid", [...path, "kind"]),
  )
  return undefined
}

function validateExpression(
  value: unknown,
  path: readonly (string | number)[],
  _mode: "default" | "generated" | "check" | "index",
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotExpression | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Expression must be an object", path))
    return undefined
  }

  requireKeys(value, ["kind", "expressionKind", "sql", "dialect"], path, diagnostics, ["dialect"])
  const expressionKind = validateName(
    value.expressionKind,
    [...path, "expressionKind"],
    diagnostics,
  )
  const sql = typeof value.sql === "string" ? value.sql : undefined

  if (sql === undefined) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Expression SQL must be a string", [...path, "sql"]),
    )
  }

  if (value.kind !== "expression") {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Expression kind must be expression", [...path, "kind"]),
    )
  }

  const expressionDialect =
    value.dialect === undefined
      ? undefined
      : validateName(value.dialect, [...path, "dialect"], diagnostics)

  if (expressionDialect !== undefined && dialect !== undefined && expressionDialect !== dialect) {
    diagnostics.push(
      diagnostic(
        "dialect-mismatch",
        `Expression dialect "${expressionDialect}" does not match snapshot dialect "${dialect}"`,
        [...path, "dialect"],
      ),
    )
  }

  if (expressionDialect !== undefined && value.expressionKind !== "unsafe") {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Only unsafe expressions may carry a dialect tag", [
        ...path,
        "dialect",
      ]),
    )
  }

  if (expressionDialect === undefined && value.expressionKind === "unsafe") {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Unsafe expressions must carry a dialect tag", [
        ...path,
        "dialect",
      ]),
    )
  }

  if (sql !== undefined && sql !== sql.replace(/\r\n?/g, "\n")) {
    diagnostics.push(
      diagnostic("non-canonical", "Expression SQL must use LF line endings", [...path, "sql"]),
    )
  }

  if (expressionKind === undefined || sql === undefined || value.kind !== "expression") {
    return undefined
  }

  return {
    kind: "expression",
    expressionKind,
    sql,
    ...(expressionDialect === undefined ? {} : { dialect: expressionDialect }),
  }
}

function validateLiteral(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): SnapshotLiteral | undefined {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Literal must be an object", path))
    return undefined
  }

  if (value.kind === "null") {
    requireKeys(value, ["kind"], path, diagnostics)
    return { kind: "null" }
  }

  if (value.kind === "boolean") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    if (typeof value.value !== "boolean") {
      diagnostics.push(
        diagnostic("invalid-snapshot", "Boolean literal value must be boolean", [...path, "value"]),
      )
    }

    return typeof value.value === "boolean"
      ? {
          kind: "boolean",
          value: value.value,
        }
      : undefined
  }

  if (value.kind === "string") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    if (typeof value.value !== "string") {
      diagnostics.push(
        diagnostic("invalid-snapshot", "String literal value must be string", [...path, "value"]),
      )
    }

    return typeof value.value === "string"
      ? {
          kind: "string",
          value: value.value,
        }
      : undefined
  }

  if (value.kind === "number" || value.kind === "bigint") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    if (
      typeof value.value !== "string" ||
      !isCanonicalIntegerOrNumber(value.value, value.kind === "bigint")
    ) {
      diagnostics.push(
        diagnostic("invalid-snapshot", `${value.kind} literal value is not canonical`, [
          ...path,
          "value",
        ]),
      )
    }

    return typeof value.value === "string" &&
      isCanonicalIntegerOrNumber(value.value, value.kind === "bigint")
      ? {
          kind: value.kind,
          value: value.value,
        }
      : undefined
  }

  diagnostics.push(diagnostic("invalid-snapshot", "Literal kind is invalid", [...path, "kind"]))
  return undefined
}

function validateExtension(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): SnapshotDialectExtension | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Dialect extension must be an object", path))
    return undefined
  }

  requireKeys(value, ["dialect", "version", "data"], path, diagnostics)
  const extensionDialect = validateName(value.dialect, [...path, "dialect"], diagnostics)
  const version = value.version

  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Dialect extension version must be a positive integer", [
        ...path,
        "version",
      ]),
    )
  } else if (version > schemaSnapshotDialectVersion) {
    diagnostics.push(
      diagnostic("future-version", `Unsupported dialect extension version: ${version}`, [
        ...path,
        "version",
      ]),
    )
  }

  if (extensionDialect !== undefined && dialect !== undefined && extensionDialect !== dialect) {
    diagnostics.push(
      diagnostic(
        "dialect-mismatch",
        `Dialect extension belongs to "${extensionDialect}" but snapshot dialect is "${dialect}"`,
        [...path, "dialect"],
      ),
    )
  }

  const data = validateJsonValue(value.data, [...path, "data"], diagnostics)

  if (extensionDialect === undefined || typeof version !== "number" || data === undefined) {
    return undefined
  }

  return {
    dialect: extensionDialect,
    version,
    data,
  }
}

function validateJsonValue(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  seen = new WeakSet<object>(),
): SnapshotJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      diagnostics.push(
        diagnostic("invalid-value", "Non-finite JSON numbers must use a tagged value", path),
      )
    }

    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value !== "object") {
    diagnostics.push(
      diagnostic("invalid-value", "Dialect data contains an unsupported value", path),
    )
    return undefined
  }

  if (seen.has(value)) {
    diagnostics.push(diagnostic("invalid-value", "Dialect data cannot be cyclic", path))
    return undefined
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        validateJsonValue(item, [...path, index], diagnostics, seen),
      ) as SnapshotJsonValue[]
    }

    if (!isRecord(value)) {
      diagnostics.push(diagnostic("invalid-value", "Dialect data must use plain objects", path))
      return undefined
    }

    if (Object.keys(value).length === 1 && "$bigint" in value) {
      if (
        typeof value.$bigint !== "string" ||
        (/^-(0|[1-9]\d*)$/u.test(value.$bigint) === false &&
          /^(0|[1-9]\d*)$/u.test(value.$bigint) === false)
      ) {
        diagnostics.push(
          diagnostic("invalid-value", "Tagged bigint is not canonical", [...path, "$bigint"]),
        )
      }

      return typeof value.$bigint === "string" ? { $bigint: value.$bigint } : undefined
    }

    if (Object.keys(value).length === 1 && "$number" in value) {
      if (
        value.$number !== "NaN" &&
        value.$number !== "Infinity" &&
        value.$number !== "-Infinity"
      ) {
        diagnostics.push(
          diagnostic("invalid-value", "Tagged number is invalid", [...path, "$number"]),
        )
      }

      return value.$number === "NaN" ||
        value.$number === "Infinity" ||
        value.$number === "-Infinity"
        ? { $number: value.$number }
        : undefined
    }

    const result: Record<string, SnapshotJsonValue> = {}

    for (const key of Object.keys(value).sort()) {
      const nested = validateJsonValue(value[key], [...path, key], diagnostics, seen)

      if (nested !== undefined) {
        result[key] = nested
      }
    }

    return result
  } finally {
    seen.delete(value)
  }
}

function validateCrossReferences(
  tables: readonly SnapshotTable[],
  diagnostics: SnapshotDiagnostic[],
): void {
  const tableMap = new Map(tables.map((table) => [table.id, table]))

  for (const [tableIndex, table] of tables.entries()) {
    const columnSet = new Set(table.columns.map((column) => column.id))

    for (const [constraintIndex, constraint] of table.constraints.entries()) {
      if (constraint.kind !== "check") {
        for (const [columnIndex, column] of constraint.columns.entries()) {
          if (!columnSet.has(column)) {
            diagnostics.push(
              diagnostic(
                "invalid-cross-reference",
                `Constraint column "${column}" is not declared on table "${table.id}"`,
                ["tables", tableIndex, "constraints", constraintIndex, "columns", columnIndex],
              ),
            )
          }
        }
      }

      if (constraint.kind === "foreign-key") {
        const target = tableMap.get(constraint.target.table)

        if (target === undefined) {
          diagnostics.push(
            diagnostic(
              "invalid-cross-reference",
              `Foreign-key target table "${constraint.target.table}" does not exist`,
              ["tables", tableIndex, "constraints", constraintIndex, "target", "table"],
            ),
          )
        } else {
          for (const [columnIndex, column] of constraint.target.columns.entries()) {
            if (!target.columns.some((targetColumn) => targetColumn.id === column)) {
              diagnostics.push(
                diagnostic(
                  "invalid-cross-reference",
                  `Foreign-key target column "${column}" is not declared on table "${target.id}"`,
                  [
                    "tables",
                    tableIndex,
                    "constraints",
                    constraintIndex,
                    "target",
                    "columns",
                    columnIndex,
                  ],
                ),
              )
            }
          }
        }
      }
    }

    for (const [indexIndex, index] of table.indexes.entries()) {
      for (const [termIndex, term] of index.terms.entries()) {
        const expression = term.kind === "order" ? term.expression : term

        if (expression.kind === "column" && !columnSet.has(expression.column)) {
          diagnostics.push(
            diagnostic(
              "invalid-cross-reference",
              `Index column "${expression.column}" is not declared on table "${table.id}"`,
              ["tables", tableIndex, "indexes", indexIndex, "terms", termIndex],
            ),
          )
        }
      }

      for (const [columnIndex, column] of (index.includedColumns ?? []).entries()) {
        if (!columnSet.has(column)) {
          diagnostics.push(
            diagnostic(
              "invalid-cross-reference",
              `Included index column "${column}" is not declared on table "${table.id}"`,
              ["tables", tableIndex, "indexes", indexIndex, "includedColumns", columnIndex],
            ),
          )
        }
      }
    }
  }
}

function validateColumnIds(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Column references must be an array", path))
    return undefined
  }

  const result: string[] = []

  for (const [index, item] of value.entries()) {
    const id = validateId(item, [...path, index], diagnostics)

    if (id !== undefined) {
      result.push(id)
    }
  }

  if (result.length === 0) {
    diagnostics.push(diagnostic("invalid-snapshot", "Column references cannot be empty", path))
  }

  return result
}

function validateArray<T>(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  validate: (value: unknown, path: readonly (string | number)[]) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("invalid-snapshot", "Value must be an array", path))
    return undefined
  }

  const result: T[] = []

  for (const [index, item] of value.entries()) {
    const validated = validate(item, [...path, index])

    if (validated !== undefined) {
      result.push(validated)
    }
  }

  return result
}

function validateSortedIds(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): void {
  if (!Array.isArray(value)) {
    return
  }

  let previous: string | undefined

  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.id !== "string") {
      continue
    }

    if (previous !== undefined && item.id <= previous) {
      diagnostics.push(
        diagnostic("non-canonical", "Entities must be sorted by stable logical ID", [
          ...path,
          index,
          "id",
        ]),
      )
    }

    previous = item.id
  }
}

function validateId(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[.\\/\u0000-\u001f\u007f]/u.test(value)
  ) {
    diagnostics.push(
      diagnostic("invalid-snapshot", "Logical IDs must be non-empty identifiers", path),
    )
    return undefined
  }

  return value
}

function validateName(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    diagnostics.push(
      diagnostic(
        "invalid-snapshot",
        "Physical names must be non-empty strings without control characters",
        path,
      ),
    )
    return undefined
  }

  return value
}

function validateBoolean(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    diagnostics.push(diagnostic("invalid-snapshot", "Value must be boolean", path))
    return undefined
  }

  return value
}

function validateOptionalBoolean(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): boolean | undefined {
  return value === undefined ? undefined : validateBoolean(value, path, diagnostics)
}

function isCanonicalIntegerOrNumber(value: string, integer: boolean): boolean {
  if (integer) {
    return /^-(0|[1-9]\d*)$/u.test(value) || /^(0|[1-9]\d*)$/u.test(value)
  }

  if (value === "0") {
    return true
  }

  return (
    /^-(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/u.test(value) ||
    /^(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/u.test(value)
  )
}

function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  optional: readonly string[] = [],
): void {
  for (const key of required) {
    if (!(key in value) && !optional.includes(key)) {
      diagnostics.push(
        diagnostic("invalid-snapshot", `Missing required field "${key}"`, [...path, key]),
      )
    }
  }

  const allowed = new Set([...required, ...optional])

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic("unknown-field", `Unknown snapshot field "${key}"`, [...path, key]),
      )
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  )
}

function diagnostic(
  code: SnapshotDiagnostic["code"],
  message: string,
  path: readonly (string | number)[],
): SnapshotDiagnostic {
  return {
    code,
    message,
    path: Object.freeze([...path]),
  }
}

function freezeSnapshot(snapshot: SchemaSnapshot): SchemaSnapshot {
  return deepFreeze(snapshot)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }

  return Object.freeze(value)
}
