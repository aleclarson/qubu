import { canonicalJson } from "./canonical.ts"
import {
  completeSchemaSnapshotFormat,
  completeSchemaSnapshotVersion,
  type CompleteSchemaSnapshot,
  type CompleteSchemaSnapshotInput,
  type CompleteSnapshotCapabilities,
  type CompleteSnapshotCheckConstraint,
  type CompleteSnapshotCollation,
  type CompleteSnapshotColumn,
  type CompleteSnapshotComment,
  type CompleteSnapshotConstraint,
  type CompleteSnapshotDeferredObject,
  type CompleteSnapshotDomain,
  type CompleteSnapshotEnum,
  type CompleteSnapshotExtension,
  type CompleteSnapshotForeignKey,
  type CompleteSnapshotIdentity,
  type CompleteSnapshotIndex,
  type CompleteSnapshotIndexTerm,
  type CompleteSnapshotNamespace,
  type CompleteSnapshotObject,
  type CompleteSnapshotObjectMetadata,
  type CompleteSnapshotObjectReference,
  type CompleteSnapshotOpaqueObject,
  type CompleteSnapshotOwnership,
  type CompleteSnapshotPartition,
  type CompleteSnapshotPhysicalReference,
  type CompleteSnapshotPolicy,
  type CompleteSnapshotProvenance,
  type CompleteSnapshotRoutine,
  type CompleteSnapshotRoutineParameter,
  type CompleteSnapshotSequence,
  type CompleteSnapshotTable,
  type CompleteSnapshotTrigger,
  type CompleteSnapshotValueFact,
  type CompleteSnapshotView,
} from "./complete-types.ts"
import type {
  SnapshotDiagnostic,
  SnapshotJsonValue,
  SnapshotLiteral,
  SnapshotStorage,
} from "./types.ts"
import { schemaSnapshotDialectVersion } from "./types.ts"

/** Error raised by throwing APIs after collecting strict v1 diagnostics. */
export class CompleteSnapshotValidationError extends TypeError {
  readonly name: string = "CompleteSnapshotValidationError"
  readonly diagnostics: readonly SnapshotDiagnostic[]
  readonly issues: readonly SnapshotDiagnostic[]

  constructor(diagnostics: readonly SnapshotDiagnostic[]) {
    const frozen = Object.freeze(
      diagnostics.map((issue) =>
        Object.freeze({
          ...issue,
          path: Object.freeze([...issue.path]),
          relatedPaths: issue.relatedPaths
            ? Object.freeze(issue.relatedPaths.map((path) => Object.freeze([...path])))
            : undefined,
        }),
      ),
    )

    super(frozen.map((issue) => issue.message).join("\n"))
    this.diagnostics = frozen
    this.issues = frozen
  }
}

/** Decode and strictly validate a complete Snapshot v1 JSON value. */
export function decodeCompleteSchemaSnapshot(
  input: string | unknown,
): import("./complete-types.ts").CompleteSnapshotDecodeResult {
  let value: unknown = input

  if (typeof input === "string") {
    try {
      value = JSON.parse(input) as unknown
    } catch (error) {
      return {
        ok: false,
        diagnostics: Object.freeze([
          issue(
            "invalid-snapshot",
            `Snapshot JSON could not be parsed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            [],
          ),
        ]),
      }
    }
  }

  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        issue("invalid-snapshot", "Snapshot root must be an object", []),
      ]),
    }
  }

  const diagnostics: SnapshotDiagnostic[] = []
  const snapshot = validateCompleteSnapshot(value, diagnostics)

  if (diagnostics.length > 0 || snapshot === undefined) {
    return {
      ok: false,
      diagnostics: Object.freeze(diagnostics),
    }
  }

  return {
    ok: true,
    value: deepFreeze(snapshot),
  }
}

/** Validate a complete snapshot and throw one structured error on failure. */
export function assertCompleteSchemaSnapshot(
  input: CompleteSchemaSnapshotInput | string,
): CompleteSchemaSnapshot {
  const result = decodeCompleteSchemaSnapshot(input)

  if (!result.ok) {
    throw new CompleteSnapshotValidationError(result.diagnostics)
  }

  return result.value
}

/** Return a fixed-order, deeply immutable complete snapshot. */
export function canonicalizeCompleteSchemaSnapshot(
  input: CompleteSchemaSnapshotInput,
): CompleteSchemaSnapshot {
  return assertCompleteSchemaSnapshot(input)
}

/** Encode a complete snapshot with deterministic property and array order. */
export function encodeCompleteSchemaSnapshot(snapshot: CompleteSchemaSnapshot): string {
  const canonical = assertCompleteSchemaSnapshot(snapshot)

  return canonicalJson(canonical as unknown as SnapshotJsonValue)
}

/** Compute the deterministic content fingerprint for a complete Snapshot v1. */
export function completeSchemaSnapshotFingerprint(
  snapshot: CompleteSchemaSnapshotInput | string,
): string {
  const source = encodeCompleteSchemaSnapshot(snapshot as CompleteSchemaSnapshot)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (let index = 0; index < source.length; index += 1) {
    const codePoint = source.codePointAt(index) ?? 0

    if (codePoint > 0xffff) {
      index += 1
    }

    for (const byte of new TextEncoder().encode(String.fromCodePoint(codePoint))) {
      hash ^= BigInt(byte)
      hash = (hash * prime) & mask
    }
  }

  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`
}

/** Numbered aliases for tooling that prefers explicit Snapshot v1 names. */
export const decodeSchemaSnapshotV1 = decodeCompleteSchemaSnapshot
export const assertSchemaSnapshotV1 = assertCompleteSchemaSnapshot
export const encodeSchemaSnapshotV1 = encodeCompleteSchemaSnapshot
export const canonicalizeSchemaSnapshotV1 = canonicalizeCompleteSchemaSnapshot
export const schemaSnapshotV1Fingerprint = completeSchemaSnapshotFingerprint
export const decodeCompleteSnapshot = decodeCompleteSchemaSnapshot
export const assertCompleteSnapshot = assertCompleteSchemaSnapshot
export const encodeCompleteSnapshot = encodeCompleteSchemaSnapshot
export const fingerprintCompleteSchemaSnapshot = completeSchemaSnapshotFingerprint

function validateCompleteSnapshot(
  value: Record<string, unknown>,
  diagnostics: SnapshotDiagnostic[],
): CompleteSchemaSnapshot | undefined {
  requireKeys(
    value,
    [
      "format",
      "version",
      "dialect",
      "namingPolicy",
      "namespace",
      "capabilities",
      "tables",
      "views",
      "sequences",
      "enums",
      "domains",
      "collations",
      "triggers",
      "routines",
      "partitions",
      "policies",
      "extensions",
      "deferredObjects",
      "opaqueObjects",
      "comments",
      "ownership",
    ],
    [],
    diagnostics,
  )
  if (value.format !== completeSchemaSnapshotFormat) {
    diagnostics.push(
      issue("invalid-snapshot", `Snapshot format must be "${completeSchemaSnapshotFormat}"`, [
        "format",
      ]),
    )
  }

  if (value.version !== completeSchemaSnapshotVersion) {
    diagnostics.push(
      issue(
        typeof value.version === "number" && value.version > completeSchemaSnapshotVersion
          ? "future-version"
          : "invalid-snapshot",
        `Unsupported complete schema snapshot version: ${String(value.version)}`,
        ["version"],
      ),
    )
  }

  const dialect = validateDialect(value.dialect, ["dialect"], diagnostics)
  const namingPolicy = validateNamingPolicy(value.namingPolicy, ["namingPolicy"], diagnostics)
  const namespace = validateNamespace(value.namespace, ["namespace"], diagnostics, dialect?.name)
  const capabilities = validateCapabilities(value.capabilities, ["capabilities"], diagnostics)
  const tables = validateObjects(value.tables, ["tables"], diagnostics, validateTable)
  const views = validateObjects(value.views, ["views"], diagnostics, validateView)
  const sequences = validateObjects(value.sequences, ["sequences"], diagnostics, validateSequence)
  const enums = validateObjects(value.enums, ["enums"], diagnostics, validateEnum)
  const domains = validateObjects(value.domains, ["domains"], diagnostics, validateDomain)
  const collations = validateObjects(
    value.collations,
    ["collations"],
    diagnostics,
    validateCollation,
  )
  const triggers = validateObjects(value.triggers, ["triggers"], diagnostics, validateTrigger)
  const routines = validateObjects(value.routines, ["routines"], diagnostics, validateRoutine)
  const partitions = validateObjects(
    value.partitions,
    ["partitions"],
    diagnostics,
    validatePartition,
  )
  const policies = validateObjects(value.policies, ["policies"], diagnostics, validatePolicy)
  const extensions = validateObjects(
    value.extensions,
    ["extensions"],
    diagnostics,
    validateExtensionObject,
  )
  const deferredObjects = validateObjects(
    value.deferredObjects,
    ["deferredObjects"],
    diagnostics,
    validateDeferredObject,
  )
  const opaqueObjects = validateObjects(
    value.opaqueObjects,
    ["opaqueObjects"],
    diagnostics,
    validateOpaqueObject,
  )
  const comments = validateObjects(value.comments, ["comments"], diagnostics, validateComment)
  const ownership = validateObjects(value.ownership, ["ownership"], diagnostics, validateOwnership)

  if (
    dialect === undefined ||
    namingPolicy === undefined ||
    namespace === undefined ||
    capabilities === undefined ||
    tables === undefined ||
    views === undefined ||
    sequences === undefined ||
    enums === undefined ||
    domains === undefined ||
    collations === undefined ||
    triggers === undefined ||
    routines === undefined ||
    partitions === undefined ||
    policies === undefined ||
    extensions === undefined ||
    deferredObjects === undefined ||
    opaqueObjects === undefined ||
    comments === undefined ||
    ownership === undefined
  ) {
    return undefined
  }

  const snapshot: CompleteSchemaSnapshot = {
    format: completeSchemaSnapshotFormat,
    version: completeSchemaSnapshotVersion,
    dialect,
    namingPolicy,
    namespace,
    capabilities,
    tables,
    views,
    sequences,
    enums,
    domains,
    collations,
    triggers,
    routines,
    partitions,
    policies,
    extensions,
    deferredObjects,
    opaqueObjects,
    comments,
    ownership,
  }

  validateCompleteDialectMetadata(snapshot, diagnostics)
  validateCompleteCrossReferences(snapshot, diagnostics)
  return diagnostics.length === 0 ? snapshot : undefined
}

function validateDialect(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Dialect must be an object", path))
    return undefined
  }

  requireKeys(value, ["name", "version"], path, diagnostics)
  const name = stringValue(value.name, [...path, "name"], diagnostics, true)
  const version = integerValue(value.version, [...path, "version"], diagnostics)

  if (version !== undefined && version < 1) {
    diagnostics.push(
      issue("invalid-snapshot", "Dialect version must be positive", [...path, "version"]),
    )
  }

  if (version !== undefined && version > schemaSnapshotDialectVersion) {
    diagnostics.push(
      issue("future-version", `Unsupported dialect version: ${version}`, [...path, "version"]),
    )
  }

  if (name === undefined || version === undefined) {
    return undefined
  }

  return {
    name,
    version,
  }
}

function validateNamingPolicy(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Naming policy must be an object", path))
    return undefined
  }

  requireKeys(value, ["name", "version"], path, diagnostics)
  const name = stringValue(value.name, [...path, "name"], diagnostics, true)
  const version = integerValue(value.version, [...path, "version"], diagnostics)

  if (version !== 1) {
    diagnostics.push(
      issue(
        typeof value.version === "number" && value.version > 1
          ? "future-version"
          : "invalid-snapshot",
        `Unsupported naming-policy version: ${String(value.version)}`,
        [...path, "version"],
      ),
    )
  }

  return name === undefined || version === undefined
    ? undefined
    : {
        name,
        version,
      }
}

function validateNamespace(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  dialect: string | undefined,
): CompleteSnapshotNamespace | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Snapshot namespace must be an object", path))
    return undefined
  }

  requireKeys(
    value,
    ["kind", "name", "provenance", "physicalReference", "dialect"],
    path,
    diagnostics,
    ["provenance", "physicalReference", "dialect"],
  )
  const kind = value.kind

  if (
    kind !== "generic" &&
    kind !== "postgres-schema" &&
    kind !== "sqlite-database" &&
    kind !== "mysql-database"
  ) {
    diagnostics.push(
      issue("invalid-snapshot", "Snapshot namespace kind is invalid", [...path, "kind"]),
    )
  }

  const name = stringValue(value.name, [...path, "name"], diagnostics, true)
  const metadata = validateObjectMetadata(value, path, dialect, diagnostics)

  return name === undefined || typeof kind !== "string"
    ? undefined
    : {
        kind: kind as CompleteSnapshotNamespace["kind"],
        name,
        ...metadata,
      }
}

function validateCapabilities(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotCapabilities | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Snapshot capabilities must be an object", path))
    return undefined
  }

  const required = [
    "generatedColumns",
    "identityMetadata",
    "checkConstraints",
    "checkConstraintEnforcement",
    "expressionDecompilation",
    "indexExpressions",
    "indexPredicates",
    "indexIncludedColumns",
    "namespaces",
    "visibility",
  ] as const

  requireKeys(value, required, path, diagnostics)
  const result: Record<string, boolean | string> = {}

  for (const key of Object.keys(value).sort()) {
    const child = value[key]

    if (typeof child !== "boolean" && typeof child !== "string") {
      diagnostics.push(
        issue("invalid-value", "Capability values must be boolean or string", [...path, key]),
      )
    } else {
      result[key] = child
    }
  }

  const enforcement = value.checkConstraintEnforcement

  if (enforcement !== "enforced" && enforcement !== "metadata-only" && enforcement !== "unknown") {
    diagnostics.push(
      issue("invalid-snapshot", "Check-constraint enforcement is invalid", [
        ...path,
        "checkConstraintEnforcement",
      ]),
    )
  }

  const visibility = value.visibility

  if (visibility !== "complete" && visibility !== "limited" && visibility !== "unknown") {
    diagnostics.push(
      issue("invalid-snapshot", "Capability visibility is invalid", [...path, "visibility"]),
    )
  }

  for (const key of required) {
    if (
      typeof value[key] !== "boolean" &&
      key !== "checkConstraintEnforcement" &&
      key !== "visibility"
    ) {
      diagnostics.push(issue("invalid-snapshot", "Capability must be boolean", [...path, key]))
    }
  }

  if (
    diagnostics.some(
      (diagnostic) =>
        diagnostic.path.length === path.length + 1 &&
        diagnostic.path.slice(0, path.length).every((part, i) => part === path[i]),
    )
  ) {
    return undefined
  }

  return result as CompleteSnapshotCapabilities
}

function validateObjects<T>(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  validate: (
    value: unknown,
    path: readonly (string | number)[],
    diagnostics: SnapshotDiagnostic[],
  ) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(issue("invalid-snapshot", "Value must be an array", path))
    return undefined
  }

  validateSortedIds(value, path, diagnostics)
  const result: T[] = []

  for (const [index, item] of value.entries()) {
    const valid = validate(item, [...path, index], diagnostics)

    if (valid !== undefined) {
      result.push(valid)
    }
  }

  return result
}

function validateObjectMetadata(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
  allowed: readonly string[] = [],
): CompleteSnapshotObjectMetadata {
  void allowed
  const provenance =
    value.provenance === undefined
      ? undefined
      : validateProvenance(value.provenance, [...path, "provenance"], dialect, diagnostics)
  const extension =
    value.dialect === undefined
      ? undefined
      : validateExtension(value.dialect, [...path, "dialect"], dialect, diagnostics)
  const physicalReference =
    value.physicalReference === undefined
      ? undefined
      : validatePhysicalReference(
          value.physicalReference,
          [...path, "physicalReference"],
          diagnostics,
        )

  return {
    ...(provenance === undefined ? {} : { provenance }),
    ...(physicalReference === undefined ? {} : { physicalReference }),
    ...(extension === undefined ? {} : { dialect: extension }),
  }
}

function validateBase(
  value: unknown,
  path: readonly (string | number)[],
  kind: string,
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
  allowed: readonly string[] = [],
):
  | {
      id: string
      physicalName: string
      metadata: CompleteSnapshotObjectMetadata
    }
  | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", `${kind} must be an object`, path))
    return undefined
  }

  requireKeys(
    value,
    ["kind", "id", "physicalName", "provenance", "physicalReference", "dialect", ...allowed],
    path,
    diagnostics,
    ["provenance", "physicalReference", "dialect", ...allowed],
  )
  if (value.kind !== kind && !(kind === "view" && value.kind === "materialized-view")) {
    diagnostics.push(issue("invalid-snapshot", `${kind} kind is invalid`, [...path, "kind"]))
  }

  const id = stringValue(value.id, [...path, "id"], diagnostics, true)
  const physicalName = stringValue(value.physicalName, [...path, "physicalName"], diagnostics, true)
  const metadata = validateObjectMetadata(value, path, dialect, diagnostics, allowed)

  return id === undefined || physicalName === undefined
    ? undefined
    : {
        id,
        physicalName,
        metadata,
      }
}

function validateTable(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotTable | undefined {
  const base = validateBase(value, path, "table", undefined, diagnostics, [
    "columns",
    "constraints",
    "indexes",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const columns = validateObjects(value.columns, [...path, "columns"], diagnostics, validateColumn)
  const constraints = validateObjects(
    value.constraints,
    [...path, "constraints"],
    diagnostics,
    validateConstraint,
  )
  const indexes = validateObjects(value.indexes, [...path, "indexes"], diagnostics, validateIndex)

  if (columns === undefined || constraints === undefined || indexes === undefined) {
    return undefined
  }

  return {
    kind: "table",
    id: base.id,
    physicalName: base.physicalName,
    columns,
    constraints,
    indexes,
    ...base.metadata,
  }
}

function validateColumn(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotColumn | undefined {
  const base = validateBase(value, path, "column", undefined, diagnostics, [
    "ordinalPosition",
    "nullable",
    "hasDefault",
    "generated",
    "storage",
    "default",
    "generatedColumn",
    "identity",
    "onUpdate",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const ordinalPosition = integerValue(
    value.ordinalPosition,
    [...path, "ordinalPosition"],
    diagnostics,
  )
  const nullable = booleanValue(value.nullable, [...path, "nullable"], diagnostics)
  const hasDefault = booleanValue(value.hasDefault, [...path, "hasDefault"], diagnostics)
  const generated = booleanValue(value.generated, [...path, "generated"], diagnostics)
  const storage =
    value.storage === undefined
      ? undefined
      : validateStorage(value.storage, [...path, "storage"], diagnostics)
  const defaultValue =
    value.default === undefined
      ? undefined
      : validateDefault(value.default, [...path, "default"], diagnostics)
  const generatedColumn =
    value.generatedColumn === undefined
      ? undefined
      : validateGenerated(value.generatedColumn, [...path, "generatedColumn"], diagnostics)
  const identity =
    value.identity === undefined
      ? undefined
      : validateIdentity(value.identity, [...path, "identity"], diagnostics)
  const onUpdate =
    value.onUpdate === undefined
      ? undefined
      : validateExpression(value.onUpdate, [...path, "onUpdate"], diagnostics)

  if (
    ordinalPosition === undefined ||
    nullable === undefined ||
    hasDefault === undefined ||
    generated === undefined
  ) {
    return undefined
  }

  return {
    kind: "column",
    id: base.id,
    physicalName: base.physicalName,
    ordinalPosition,
    nullable,
    hasDefault,
    generated,
    ...(storage === undefined ? {} : { storage }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(generatedColumn === undefined ? {} : { generatedColumn }),
    ...(identity === undefined ? {} : { identity }),
    ...(onUpdate === undefined ? {} : { onUpdate }),
    ...base.metadata,
  }
}

function validateConstraint(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotConstraint | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Constraint must be an object", path))
    return undefined
  }

  const kind = value.kind
  const allowed =
    kind === "foreign-key"
      ? [
          "columns",
          "target",
          "onUpdate",
          "onDelete",
          "match",
          "deferrable",
          "initially",
          "validated",
        ]
      : kind === "check"
        ? ["expression", "deferrable", "initially", "validated"]
        : ["columns", "nulls", "backingIndex", "deferrable", "initially", "validated"]
  const base = validateBase(value, path, String(kind), undefined, diagnostics, allowed)

  if (base === undefined) {
    return undefined
  }

  if (kind === "check") {
    const expression = validateExpression(value.expression, [...path, "expression"], diagnostics)
    const timing = validateTiming(value, path, diagnostics)
    const validated = optionalBoolean(value.validated, [...path, "validated"], diagnostics)

    if (expression === undefined) {
      return undefined
    }

    return {
      kind: "check",
      id: base.id,
      physicalName: base.physicalName,
      expression,
      ...timing,
      ...(validated === undefined ? {} : { validated }),
      ...base.metadata,
    }
  }

  if (kind === "foreign-key") {
    const columns = validateIds(value.columns, [...path, "columns"], diagnostics)
    const target = validateForeignKeyTarget(value.target, [...path, "target"], diagnostics)
    const onUpdate = validateAction(value.onUpdate, [...path, "onUpdate"], diagnostics)
    const onDelete = validateAction(value.onDelete, [...path, "onDelete"], diagnostics)
    const match = validateMatch(value.match, [...path, "match"], diagnostics)
    const timing = validateTiming(value, path, diagnostics)
    const validated = optionalBoolean(value.validated, [...path, "validated"], diagnostics)

    if (columns === undefined || target === undefined) {
      return undefined
    }

    return {
      kind: "foreign-key",
      id: base.id,
      physicalName: base.physicalName,
      columns,
      target,
      ...(onUpdate === undefined ? {} : { onUpdate }),
      ...(onDelete === undefined ? {} : { onDelete }),
      ...(match === undefined ? {} : { match }),
      ...timing,
      ...(validated === undefined ? {} : { validated }),
      ...base.metadata,
    }
  }

  if (kind !== "primary-key" && kind !== "unique" && kind !== "unique-constraint") {
    diagnostics.push(issue("invalid-snapshot", "Constraint kind is invalid", [...path, "kind"]))
    return undefined
  }

  const columns = validateIds(value.columns, [...path, "columns"], diagnostics)
  const nulls =
    value.nulls === undefined
      ? undefined
      : validateNulls(value.nulls, [...path, "nulls"], diagnostics)
  const backingIndex =
    value.backingIndex === undefined
      ? undefined
      : validateObjectReference(value.backingIndex, [...path, "backingIndex"], diagnostics)
  const timing = validateTiming(value, path, diagnostics)
  const validated = optionalBoolean(value.validated, [...path, "validated"], diagnostics)

  if (columns === undefined) {
    return undefined
  }

  if (kind === "unique-constraint" && nulls === undefined) {
    diagnostics.push(
      issue("invalid-snapshot", "Unique constraints require nulls semantics", [...path, "nulls"]),
    )
    return undefined
  }

  return {
    kind,
    id: base.id,
    physicalName: base.physicalName,
    columns,
    ...(nulls === undefined ? {} : { nulls }),
    ...(backingIndex === undefined ? {} : { backingIndex }),
    ...timing,
    ...(validated === undefined ? {} : { validated }),
    ...base.metadata,
  }
}

function validateIndex(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotIndex | undefined {
  const base = validateBase(value, path, "index", undefined, diagnostics, [
    "terms",
    "unique",
    "candidateKey",
    "predicate",
    "includedColumns",
    "backingConstraint",
    "method",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const terms = validateArray(value.terms, [...path, "terms"], diagnostics, validateIndexTerm)

  if (terms !== undefined) {
    validateSortedPositions(terms, [...path, "terms"], diagnostics)
  }

  const unique = booleanValue(value.unique, [...path, "unique"], diagnostics)
  const candidateKey = booleanValue(value.candidateKey, [...path, "candidateKey"], diagnostics)
  const predicate =
    value.predicate === undefined
      ? undefined
      : validateExpression(value.predicate, [...path, "predicate"], diagnostics)
  const includedColumns =
    value.includedColumns === undefined
      ? undefined
      : validateIds(value.includedColumns, [...path, "includedColumns"], diagnostics, false)
  const backingConstraint =
    value.backingConstraint === undefined
      ? undefined
      : validateObjectReference(
          value.backingConstraint,
          [...path, "backingConstraint"],
          diagnostics,
        )
  const method =
    value.method === undefined
      ? undefined
      : stringValue(value.method, [...path, "method"], diagnostics, true)

  if (terms === undefined || unique === undefined || candidateKey === undefined) {
    return undefined
  }

  return {
    kind: "index",
    id: base.id,
    physicalName: base.physicalName,
    terms,
    unique,
    candidateKey,
    ...(predicate === undefined ? {} : { predicate }),
    ...(includedColumns === undefined ? {} : { includedColumns }),
    ...(backingConstraint === undefined ? {} : { backingConstraint }),
    ...(method === undefined ? {} : { method }),
    ...base.metadata,
  }
}

function validateIndexTerm(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotIndexTerm | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Index term must be an object", path))
    return undefined
  }

  const kind = value.kind

  requireKeys(
    value,
    [
      "kind",
      "position",
      "direction",
      "nulls",
      "operatorClass",
      ...(kind === "column" ? ["column", "prefixLength"] : ["expression"]),
    ],
    path,
    diagnostics,
    ["direction", "nulls", "operatorClass", "prefixLength"],
  )
  const position = integerValue(value.position, [...path, "position"], diagnostics)
  const direction = validateDirection(value.direction, [...path, "direction"], diagnostics)
  const nulls = validateIndexNulls(value.nulls, [...path, "nulls"], diagnostics)
  const operatorClass =
    value.operatorClass === undefined
      ? undefined
      : stringValue(value.operatorClass, [...path, "operatorClass"], diagnostics, true)

  if (kind === "column") {
    const column = stringValue(value.column, [...path, "column"], diagnostics, true)
    const prefixLength =
      value.prefixLength === undefined
        ? undefined
        : validateValueFact(value.prefixLength, [...path, "prefixLength"], diagnostics)

    if (column === undefined || position === undefined) {
      return undefined
    }

    return {
      kind: "column",
      column,
      position,
      ...(direction === undefined ? {} : { direction }),
      ...(nulls === undefined ? {} : { nulls }),
      ...(prefixLength === undefined ? {} : { prefixLength }),
      ...(operatorClass === undefined ? {} : { operatorClass }),
    }
  }

  if (kind === "expression") {
    const expression = validateExpression(value.expression, [...path, "expression"], diagnostics)

    if (expression === undefined || position === undefined) {
      return undefined
    }

    return {
      kind: "expression",
      expression,
      position,
      ...(direction === undefined ? {} : { direction }),
      ...(nulls === undefined ? {} : { nulls }),
      ...(operatorClass === undefined ? {} : { operatorClass }),
    }
  }

  diagnostics.push(issue("invalid-snapshot", "Index term kind is invalid", [...path, "kind"]))
  return undefined
}

function validateView(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotView | undefined {
  const base = validateBase(value, path, "view", undefined, diagnostics, [
    "columns",
    "definition",
    "dependencies",
    "checkOption",
    "securityBarrier",
    "securityInvoker",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const columns = validateObjects(value.columns, [...path, "columns"], diagnostics, validateColumn)
  const definition = validateExpression(value.definition, [...path, "definition"], diagnostics)
  const dependencies =
    value.dependencies === undefined
      ? undefined
      : validateReferences(value.dependencies, [...path, "dependencies"], diagnostics)
  const checkOption = validateCheckOption(value.checkOption, [...path, "checkOption"], diagnostics)
  const securityBarrier = optionalBoolean(
    value.securityBarrier,
    [...path, "securityBarrier"],
    diagnostics,
  )
  const securityInvoker = optionalBoolean(
    value.securityInvoker,
    [...path, "securityInvoker"],
    diagnostics,
  )

  if (columns === undefined || definition === undefined) {
    return undefined
  }

  return {
    kind: value.kind as "view" | "materialized-view",
    id: base.id,
    physicalName: base.physicalName,
    columns,
    definition,
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(checkOption === undefined ? {} : { checkOption }),
    ...(securityBarrier === undefined ? {} : { securityBarrier }),
    ...(securityInvoker === undefined ? {} : { securityInvoker }),
    ...base.metadata,
  }
}

function validateSequence(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotSequence | undefined {
  const base = validateBase(value, path, "sequence", undefined, diagnostics, [
    "storage",
    "start",
    "increment",
    "minimum",
    "maximum",
    "cache",
    "cycle",
    "ownedBy",
    "identity",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const storage =
    value.storage === undefined
      ? undefined
      : validateStorage(value.storage, [...path, "storage"], diagnostics)
  const start =
    value.start === undefined
      ? undefined
      : validateValueFact(value.start, [...path, "start"], diagnostics)
  const increment =
    value.increment === undefined
      ? undefined
      : validateValueFact(value.increment, [...path, "increment"], diagnostics)
  const minimum =
    value.minimum === undefined
      ? undefined
      : validateValueFact(value.minimum, [...path, "minimum"], diagnostics)
  const maximum =
    value.maximum === undefined
      ? undefined
      : validateValueFact(value.maximum, [...path, "maximum"], diagnostics)
  const cache =
    value.cache === undefined
      ? undefined
      : validateValueFact(value.cache, [...path, "cache"], diagnostics)
  const cycle = optionalBoolean(value.cycle, [...path, "cycle"], diagnostics)
  const ownedBy =
    value.ownedBy === undefined
      ? undefined
      : validateObjectReference(value.ownedBy, [...path, "ownedBy"], diagnostics)
  const identity =
    value.identity === undefined
      ? undefined
      : validateIdentity(value.identity, [...path, "identity"], diagnostics)

  return {
    kind: "sequence",
    id: base.id,
    physicalName: base.physicalName,
    ...(storage === undefined ? {} : { storage }),
    ...(start === undefined ? {} : { start }),
    ...(increment === undefined ? {} : { increment }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(cache === undefined ? {} : { cache }),
    ...(cycle === undefined ? {} : { cycle }),
    ...(ownedBy === undefined ? {} : { ownedBy }),
    ...(identity === undefined ? {} : { identity }),
    ...base.metadata,
  }
}

function validateEnum(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotEnum | undefined {
  const base = validateBase(value, path, "enum", undefined, diagnostics, ["values"])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const values = validateArray(value.values, [...path, "values"], diagnostics, validateEnumValue)

  if (values === undefined) {
    return undefined
  }

  let previous = -1

  for (const [index, item] of values.entries()) {
    if (item.ordinalPosition <= previous) {
      diagnostics.push(
        issue("non-canonical", "Enum labels must be sorted by ordinal position", [
          ...path,
          "values",
          index,
          "ordinalPosition",
        ]),
      )
    }

    previous = item.ordinalPosition
  }

  return {
    kind: "enum",
    id: base.id,
    physicalName: base.physicalName,
    values,
    ...base.metadata,
  }
}

function validateEnumValue(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotEnum["values"][number] | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Enum value must be an object", path))
    return undefined
  }

  requireKeys(value, ["value", "ordinalPosition", "provenance"], path, diagnostics, ["provenance"])
  const label = stringValue(value.value, [...path, "value"], diagnostics)
  const ordinalPosition = integerValue(
    value.ordinalPosition,
    [...path, "ordinalPosition"],
    diagnostics,
  )
  const provenance =
    value.provenance === undefined
      ? undefined
      : validateProvenance(value.provenance, [...path, "provenance"], undefined, diagnostics)

  return label === undefined || ordinalPosition === undefined
    ? undefined
    : {
        value: label,
        ordinalPosition,
        ...(provenance === undefined ? {} : { provenance }),
      }
}

function validateDomain(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotDomain | undefined {
  const base = validateBase(value, path, "domain", undefined, diagnostics, [
    "storage",
    "nullable",
    "default",
    "constraints",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const storage = validateStorage(value.storage, [...path, "storage"], diagnostics)
  const nullable = optionalBoolean(value.nullable, [...path, "nullable"], diagnostics)
  const defaultValue =
    value.default === undefined
      ? undefined
      : validateValueFact(value.default, [...path, "default"], diagnostics)
  const constraints =
    value.constraints === undefined
      ? undefined
      : validateArray(
          value.constraints,
          [...path, "constraints"],
          diagnostics,
          validateCheckConstraint,
        )

  if (storage === undefined) {
    return undefined
  }

  return {
    kind: "domain",
    id: base.id,
    physicalName: base.physicalName,
    storage,
    ...(nullable === undefined ? {} : { nullable }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(constraints === undefined ? {} : { constraints }),
    ...base.metadata,
  }
}

function validateCheckConstraint(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotCheckConstraint | undefined {
  const constraint = validateConstraint(value, path, diagnostics)

  if (constraint?.kind !== "check") {
    diagnostics.push(
      issue("invalid-snapshot", "Domain constraints must be check constraints", path),
    )
    return undefined
  }

  return constraint
}

function validateCollation(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotCollation | undefined {
  const base = validateBase(value, path, "collation", undefined, diagnostics, [
    "provider",
    "locale",
    "deterministic",
    "version",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const provider =
    value.provider === undefined
      ? undefined
      : stringValue(value.provider, [...path, "provider"], diagnostics, true)
  const locale =
    value.locale === undefined
      ? undefined
      : stringValue(value.locale, [...path, "locale"], diagnostics)
  const deterministic = optionalBoolean(
    value.deterministic,
    [...path, "deterministic"],
    diagnostics,
  )
  const version =
    value.version === undefined
      ? undefined
      : stringValue(value.version, [...path, "version"], diagnostics)

  return {
    kind: "collation",
    id: base.id,
    physicalName: base.physicalName,
    ...(provider === undefined ? {} : { provider }),
    ...(locale === undefined ? {} : { locale }),
    ...(deterministic === undefined ? {} : { deterministic }),
    ...(version === undefined ? {} : { version }),
    ...base.metadata,
  }
}

function validateTrigger(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotTrigger | undefined {
  const base = validateBase(value, path, "trigger", undefined, diagnostics, [
    "table",
    "timing",
    "events",
    "orientation",
    "condition",
    "body",
    "enabled",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const table = validateObjectReference(value.table, [...path, "table"], diagnostics)
  const timing = validateTimingKind(value.timing, [...path, "timing"], diagnostics)
  const events = validateEvents(value.events, [...path, "events"], diagnostics)
  const orientation = validateOrientation(value.orientation, [...path, "orientation"], diagnostics)
  const condition =
    value.condition === undefined
      ? undefined
      : validateExpression(value.condition, [...path, "condition"], diagnostics)
  const body = validateExpression(value.body, [...path, "body"], diagnostics)
  const enabled = optionalBoolean(value.enabled, [...path, "enabled"], diagnostics)

  if (table === undefined || timing === undefined || events === undefined || body === undefined) {
    return undefined
  }

  return {
    kind: "trigger",
    id: base.id,
    physicalName: base.physicalName,
    table,
    timing,
    events,
    ...(orientation === undefined ? {} : { orientation }),
    ...(condition === undefined ? {} : { condition }),
    body,
    ...(enabled === undefined ? {} : { enabled }),
    ...base.metadata,
  }
}

function validateRoutine(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotRoutine | undefined {
  const base = validateBase(value, path, "routine", undefined, diagnostics, [
    "routineKind",
    "parameters",
    "returnType",
    "language",
    "body",
    "volatility",
    "parallel",
    "security",
    "dependencies",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const routineKind = validateRoutineKind(value.routineKind, [...path, "routineKind"], diagnostics)
  const parameters = validateArray(
    value.parameters,
    [...path, "parameters"],
    diagnostics,
    validateRoutineParameter,
  )

  if (parameters !== undefined) {
    validateSortedPositions(parameters, [...path, "parameters"], diagnostics)
  }

  const returnType =
    value.returnType === undefined
      ? undefined
      : validateStorage(value.returnType, [...path, "returnType"], diagnostics)
  const language =
    value.language === undefined
      ? undefined
      : stringValue(value.language, [...path, "language"], diagnostics, true)
  const body =
    value.body === undefined
      ? undefined
      : validateExpression(value.body, [...path, "body"], diagnostics)
  const volatility = validateChoice(
    value.volatility,
    ["immutable", "stable", "volatile", "unknown"] as const,
    [...path, "volatility"],
    diagnostics,
  )
  const parallel = validateChoice(
    value.parallel,
    ["safe", "restricted", "unsafe", "unknown"] as const,
    [...path, "parallel"],
    diagnostics,
  )
  const security = validateChoice(
    value.security,
    ["invoker", "definer", "unknown"] as const,
    [...path, "security"],
    diagnostics,
  )
  const dependencies =
    value.dependencies === undefined
      ? undefined
      : validateReferences(value.dependencies, [...path, "dependencies"], diagnostics)

  if (routineKind === undefined || parameters === undefined) {
    return undefined
  }

  return {
    kind: "routine",
    id: base.id,
    physicalName: base.physicalName,
    routineKind,
    parameters,
    ...(returnType === undefined ? {} : { returnType }),
    ...(language === undefined ? {} : { language }),
    ...(body === undefined ? {} : { body }),
    ...(volatility === undefined ? {} : { volatility }),
    ...(parallel === undefined ? {} : { parallel }),
    ...(security === undefined ? {} : { security }),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...base.metadata,
  }
}

function validateRoutineParameter(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotRoutineParameter | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Routine parameter must be an object", path))
    return undefined
  }

  requireKeys(value, ["name", "mode", "storage", "default", "ordinalPosition"], path, diagnostics, [
    "name",
    "mode",
    "default",
  ])
  const name =
    value.name === undefined ? undefined : stringValue(value.name, [...path, "name"], diagnostics)
  const mode = validateChoice(
    value.mode,
    ["in", "out", "inout", "variadic", "table"] as const,
    [...path, "mode"],
    diagnostics,
  )
  const storage = validateStorage(value.storage, [...path, "storage"], diagnostics)
  const defaultValue =
    value.default === undefined
      ? undefined
      : validateValueFact(value.default, [...path, "default"], diagnostics)
  const ordinalPosition = integerValue(
    value.ordinalPosition,
    [...path, "ordinalPosition"],
    diagnostics,
  )

  return storage === undefined || ordinalPosition === undefined
    ? undefined
    : {
        ...(name === undefined ? {} : { name }),
        ...(mode === undefined ? {} : { mode }),
        storage,
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ordinalPosition,
      }
}

function validatePartition(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotPartition | undefined {
  const base = validateBase(value, path, "partition", undefined, diagnostics, [
    "parent",
    "strategy",
    "keyColumns",
    "bound",
    "default",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const parent = validateObjectReference(value.parent, [...path, "parent"], diagnostics)
  const strategy = validateChoice(
    value.strategy,
    ["range", "list", "hash", "reference", "unknown"] as const,
    [...path, "strategy"],
    diagnostics,
  )
  const keyColumns =
    value.keyColumns === undefined
      ? undefined
      : validateIds(value.keyColumns, [...path, "keyColumns"], diagnostics, false)
  const bound =
    value.bound === undefined
      ? undefined
      : validateExpression(value.bound, [...path, "bound"], diagnostics)
  const defaultValue = optionalBoolean(value.default, [...path, "default"], diagnostics)

  if (parent === undefined || strategy === undefined) {
    return undefined
  }

  return {
    kind: "partition",
    id: base.id,
    physicalName: base.physicalName,
    parent,
    strategy,
    ...(keyColumns === undefined ? {} : { keyColumns }),
    ...(bound === undefined ? {} : { bound }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...base.metadata,
  }
}

function validatePolicy(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotPolicy | undefined {
  const base = validateBase(value, path, "policy", undefined, diagnostics, [
    "table",
    "command",
    "roles",
    "permissive",
    "using",
    "check",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const table = validateObjectReference(value.table, [...path, "table"], diagnostics)
  const command = validateChoice(
    value.command,
    ["all", "select", "insert", "update", "delete", "unknown"] as const,
    [...path, "command"],
    diagnostics,
  )
  const roles =
    value.roles === undefined
      ? undefined
      : validateStrings(value.roles, [...path, "roles"], diagnostics, false)
  const permissive = optionalBoolean(value.permissive, [...path, "permissive"], diagnostics)
  const using =
    value.using === undefined
      ? undefined
      : validateExpression(value.using, [...path, "using"], diagnostics)
  const check =
    value.check === undefined
      ? undefined
      : validateExpression(value.check, [...path, "check"], diagnostics)

  if (table === undefined || command === undefined) {
    return undefined
  }

  return {
    kind: "policy",
    id: base.id,
    physicalName: base.physicalName,
    table,
    command,
    ...(roles === undefined ? {} : { roles }),
    ...(permissive === undefined ? {} : { permissive }),
    ...(using === undefined ? {} : { using }),
    ...(check === undefined ? {} : { check }),
    ...base.metadata,
  }
}

function validateExtensionObject(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotExtension | undefined {
  const base = validateBase(value, path, "extension", undefined, diagnostics, [
    "extensionName",
    "extensionVersion",
    "schema",
    "data",
    "configuration",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const extensionName = stringValue(
    value.extensionName,
    [...path, "extensionName"],
    diagnostics,
    true,
  )
  const extensionVersion =
    value.extensionVersion === undefined
      ? undefined
      : stringValue(value.extensionVersion, [...path, "extensionVersion"], diagnostics)
  const schema =
    value.schema === undefined
      ? undefined
      : stringValue(value.schema, [...path, "schema"], diagnostics, true)
  const data = validateJsonValue(value.data, [...path, "data"], diagnostics)
  const configuration =
    value.configuration === undefined
      ? undefined
      : validateJsonValue(value.configuration, [...path, "configuration"], diagnostics)

  if (extensionName === undefined || data === undefined) {
    return undefined
  }

  return {
    kind: "extension",
    id: base.id,
    physicalName: base.physicalName,
    extensionName,
    ...(extensionVersion === undefined ? {} : { extensionVersion }),
    ...(schema === undefined ? {} : { schema }),
    data,
    ...(configuration === undefined ? {} : { configuration }),
    ...base.metadata,
  }
}

function validateDeferredObject(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotDeferredObject | undefined {
  const base = validateBase(value, path, "deferred-object", undefined, diagnostics, [
    "objectKind",
    "reason",
    "data",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const objectKind = stringValue(value.objectKind, [...path, "objectKind"], diagnostics, true)
  const reason =
    value.reason === undefined
      ? undefined
      : stringValue(value.reason, [...path, "reason"], diagnostics)
  const data =
    value.data === undefined
      ? undefined
      : validateJsonValue(value.data, [...path, "data"], diagnostics)

  if (objectKind === undefined) {
    return undefined
  }

  return {
    kind: "deferred-object",
    id: base.id,
    objectKind,
    physicalName: base.physicalName,
    ...(reason === undefined ? {} : { reason }),
    ...(data === undefined ? {} : { data }),
    ...base.metadata,
  }
}

function validateOpaqueObject(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotOpaqueObject | undefined {
  const base = validateBase(value, path, "opaque-object", undefined, diagnostics, [
    "objectKind",
    "data",
    "sql",
  ])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const objectKind = stringValue(value.objectKind, [...path, "objectKind"], diagnostics, true)
  const data = validateJsonValue(value.data, [...path, "data"], diagnostics)
  const sql =
    value.sql === undefined
      ? undefined
      : validateExpression(value.sql, [...path, "sql"], diagnostics)

  if (objectKind === undefined || data === undefined) {
    return undefined
  }

  return {
    kind: "opaque-object",
    id: base.id,
    objectKind,
    physicalName: base.physicalName,
    data,
    ...(sql === undefined ? {} : { sql }),
    ...base.metadata,
  }
}

function validateComment(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotComment | undefined {
  const base = validateBase(value, path, "comment", undefined, diagnostics, ["object", "text"])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const object = validateObjectReference(value.object, [...path, "object"], diagnostics)
  const text = stringValue(value.text, [...path, "text"], diagnostics)

  if (object === undefined || text === undefined) {
    return undefined
  }

  return {
    kind: "comment",
    id: base.id,
    physicalName: base.physicalName,
    object,
    text,
    ...base.metadata,
  }
}

function validateOwnership(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotOwnership | undefined {
  const base = validateBase(value, path, "ownership", undefined, diagnostics, ["object", "owner"])

  if (!isRecord(value) || base === undefined) {
    return undefined
  }

  const object = validateObjectReference(value.object, [...path, "object"], diagnostics)
  const owner = stringValue(value.owner, [...path, "owner"], diagnostics, true)

  if (object === undefined || owner === undefined) {
    return undefined
  }

  return {
    kind: "ownership",
    id: base.id,
    physicalName: base.physicalName,
    object,
    owner,
    ...base.metadata,
  }
}

function validateStorage(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): SnapshotStorage | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Storage must be an object", path))
    return undefined
  }

  if (value.kind === "portable") {
    requireKeys(value, ["kind", "type"], path, diagnostics)
    const type = stringValue(value.type, [...path, "type"], diagnostics, true)

    return type === undefined
      ? undefined
      : {
          kind: "portable",
          type,
        }
  }

  if (value.kind === "native") {
    requireKeys(value, ["kind", "dialect", "type", "affinity"], path, diagnostics, ["affinity"])
    const dialect = stringValue(value.dialect, [...path, "dialect"], diagnostics, true)
    const type = stringValue(value.type, [...path, "type"], diagnostics, true)
    const affinity =
      value.affinity === undefined
        ? undefined
        : validateChoice(
            value.affinity,
            ["blob", "integer", "numeric", "real", "text"] as const,
            [...path, "affinity"],
            diagnostics,
          )

    if (dialect === undefined || type === undefined) {
      return undefined
    }

    return {
      kind: "native",
      dialect,
      type,
      ...(affinity === undefined ? {} : { affinity }),
    }
  }

  diagnostics.push(issue("invalid-snapshot", "Storage kind is invalid", [...path, "kind"]))
  return undefined
}

function validateDefault(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Default must be an object", path))
    return undefined
  }

  if (value.kind === "external") {
    requireKeys(value, ["kind"], path, diagnostics)
    return { kind: "external" as const }
  }

  if (value.kind === "literal") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    const literal = validateLiteral(value.value, [...path, "value"], diagnostics)

    return literal === undefined
      ? undefined
      : {
          kind: "literal" as const,
          value: literal,
        }
  }

  if (value.kind === "expression") {
    requireKeys(value, ["kind", "expression"], path, diagnostics)
    const expression = validateExpression(value.expression, [...path, "expression"], diagnostics)

    return expression === undefined
      ? undefined
      : {
          kind: "expression" as const,
          expression,
        }
  }

  diagnostics.push(issue("invalid-snapshot", "Default kind is invalid", [...path, "kind"]))
  return undefined
}

function validateGenerated(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Generated-column metadata must be an object", path))
    return undefined
  }

  if (value.kind === "external") {
    requireKeys(value, ["kind"], path, diagnostics)
    return { kind: "external" as const }
  }

  if (value.kind === "expression") {
    requireKeys(value, ["kind", "expression", "mode"], path, diagnostics)
    const expression = validateExpression(value.expression, [...path, "expression"], diagnostics)
    const mode = validateChoice(
      value.mode,
      ["stored", "virtual"] as const,
      [...path, "mode"],
      diagnostics,
    )

    return expression === undefined || mode === undefined
      ? undefined
      : {
          kind: "expression" as const,
          expression,
          mode,
        }
  }

  diagnostics.push(issue("invalid-snapshot", "Generated-column kind is invalid", [...path, "kind"]))
  return undefined
}

function validateIdentity(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotIdentity | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Identity must be an object", path))
    return undefined
  }

  requireKeys(
    value,
    ["kind", "generation", "options", "provenance", "physicalReference", "dialect"],
    path,
    diagnostics,
    ["provenance", "physicalReference", "dialect"],
  )
  if (value.kind !== "identity") {
    diagnostics.push(issue("invalid-snapshot", "Identity kind must be identity", [...path, "kind"]))
  }

  const generation = validateChoice(
    value.generation,
    ["always", "by-default"] as const,
    [...path, "generation"],
    diagnostics,
  )
  const options = validateValueFactRecord(value.options, [...path, "options"], diagnostics)
  const metadata = validateObjectMetadata(value, path, undefined, diagnostics)

  if (generation === undefined || options === undefined || value.kind !== "identity") {
    return undefined
  }

  return {
    kind: "identity",
    generation,
    options,
    ...metadata,
  }
}

function validateExpression(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Expression must be an object", path))
    return undefined
  }

  requireKeys(value, ["kind", "expressionKind", "sql", "dialect"], path, diagnostics, ["dialect"])
  const expressionKind = stringValue(
    value.expressionKind,
    [...path, "expressionKind"],
    diagnostics,
    true,
  )
  const sql = stringValue(value.sql, [...path, "sql"], diagnostics)
  const dialect =
    value.dialect === undefined
      ? undefined
      : stringValue(value.dialect, [...path, "dialect"], diagnostics, true)

  if (value.kind !== "expression") {
    diagnostics.push(
      issue("invalid-snapshot", "Expression kind must be expression", [...path, "kind"]),
    )
  }

  if (sql !== undefined && sql !== sql.replace(/\r\n?/g, "\n")) {
    diagnostics.push(
      issue("non-canonical", "Expression SQL must use LF line endings", [...path, "sql"]),
    )
  }

  if (expressionKind === "unsafe" && dialect === undefined) {
    diagnostics.push(
      issue("invalid-snapshot", "Unsafe expressions must carry a dialect tag", [
        ...path,
        "dialect",
      ]),
    )
  }

  if (expressionKind !== undefined && expressionKind !== "unsafe" && dialect !== undefined) {
    diagnostics.push(
      issue("invalid-snapshot", "Only unsafe expressions may carry a dialect tag", [
        ...path,
        "dialect",
      ]),
    )
  }

  if (expressionKind === undefined || sql === undefined || value.kind !== "expression") {
    return undefined
  }

  return {
    kind: "expression" as const,
    expressionKind,
    sql,
    ...(dialect === undefined ? {} : { dialect }),
  }
}

function validateLiteral(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): SnapshotLiteral | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Literal must be an object", path))
    return undefined
  }

  if (value.kind === "null") {
    requireKeys(value, ["kind"], path, diagnostics)
    return { kind: "null" }
  }

  if (value.kind === "boolean" || value.kind === "string") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    const expected = value.kind === "boolean" ? "boolean" : "string"

    if (typeof value.value !== expected) {
      diagnostics.push(
        issue("invalid-snapshot", `${expected} literal value is invalid`, [...path, "value"]),
      )
    }

    return typeof value.value === expected
      ? ({
          kind: value.kind,
          value: value.value,
        } as SnapshotLiteral)
      : undefined
  }

  if (value.kind === "number" || value.kind === "bigint") {
    requireKeys(value, ["kind", "value"], path, diagnostics)
    const raw = value.value
    const valid = typeof raw === "string" && isCanonicalNumber(raw, value.kind === "bigint")

    if (!valid) {
      diagnostics.push(
        issue("invalid-snapshot", `${value.kind} literal value is not canonical`, [
          ...path,
          "value",
        ]),
      )
    }

    return valid
      ? {
          kind: value.kind,
          value: raw as string,
        }
      : undefined
  }

  diagnostics.push(issue("invalid-snapshot", "Literal kind is invalid", [...path, "kind"]))
  return undefined
}

function validateValueFact(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotValueFact | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Value fact must be an object", path))
    return undefined
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
    const expression = validateExpression(value.expression, [...path, "expression"], diagnostics)

    return expression === undefined
      ? undefined
      : {
          kind: "expression",
          expression,
        }
  }

  diagnostics.push(issue("invalid-snapshot", "Value fact kind is invalid", [...path, "kind"]))
  return undefined
}

function validateValueFactRecord(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): Readonly<Record<string, CompleteSnapshotValueFact>> | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Value-fact options must be an object", path))
    return undefined
  }

  const result: Record<string, CompleteSnapshotValueFact> = {}

  for (const key of Object.keys(value).sort()) {
    const fact = validateValueFact(value[key], [...path, key], diagnostics)

    if (fact !== undefined) {
      result[key] = fact
    }
  }

  return result
}

function validateProvenance(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotProvenance | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Provenance must be an object", path))
    return undefined
  }

  requireKeys(value, ["kind", "dialect", "path"], path, diagnostics, ["path"])
  const kind = validateChoice(
    value.kind,
    ["catalog", "decompiler", "create-sql"] as const,
    [...path, "kind"],
    diagnostics,
  )
  const sourceDialect = stringValue(value.dialect, [...path, "dialect"], diagnostics, true)
  const sourcePath =
    value.path === undefined ? undefined : validatePath(value.path, [...path, "path"], diagnostics)

  if (dialect !== undefined && sourceDialect !== undefined && sourceDialect !== dialect) {
    diagnostics.push(
      issue(
        "dialect-mismatch",
        `Provenance belongs to "${sourceDialect}" but snapshot dialect is "${dialect}"`,
        [...path, "dialect"],
      ),
    )
  }

  if (kind === undefined || sourceDialect === undefined) {
    return undefined
  }

  return {
    kind,
    dialect: sourceDialect,
    ...(sourcePath === undefined ? {} : { path: sourcePath }),
  }
}

function validatePhysicalReference(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotPhysicalReference | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Physical reference must be an object", path))
    return undefined
  }

  requireKeys(value, ["kind", "namespace", "table", "name"], path, diagnostics, [
    "namespace",
    "table",
  ])
  const kind = stringValue(value.kind, [...path, "kind"], diagnostics, true)
  const namespace =
    value.namespace === undefined
      ? undefined
      : stringValue(value.namespace, [...path, "namespace"], diagnostics, true)
  const table =
    value.table === undefined
      ? undefined
      : stringValue(value.table, [...path, "table"], diagnostics, true)
  const name = stringValue(value.name, [...path, "name"], diagnostics, true)

  if (kind !== undefined && !completeObjectKinds.has(kind) && kind !== "namespace") {
    diagnostics.push(
      issue("invalid-snapshot", `Unknown physical reference kind: ${kind}`, [...path, "kind"]),
    )
  }

  return kind === undefined || name === undefined
    ? undefined
    : {
        kind: kind as CompleteSnapshotPhysicalReference["kind"],
        ...(namespace === undefined ? {} : { namespace }),
        ...(table === undefined ? {} : { table }),
        name,
      }
}

function validateExtension(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string | undefined,
  diagnostics: SnapshotDiagnostic[],
) {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Dialect extension must be an object", path))
    return undefined
  }

  requireKeys(value, ["dialect", "version", "data"], path, diagnostics)
  const extensionDialect = stringValue(value.dialect, [...path, "dialect"], diagnostics, true)
  const version = integerValue(value.version, [...path, "version"], diagnostics)
  const data = validateJsonValue(value.data, [...path, "data"], diagnostics)

  if (version !== undefined && version < 1) {
    diagnostics.push(
      issue("invalid-snapshot", "Dialect extension version must be positive", [...path, "version"]),
    )
  }

  if (version !== undefined && version > schemaSnapshotDialectVersion) {
    diagnostics.push(
      issue("future-version", `Unsupported dialect extension version: ${version}`, [
        ...path,
        "version",
      ]),
    )
  }

  if (dialect !== undefined && extensionDialect !== undefined && extensionDialect !== dialect) {
    diagnostics.push(
      issue(
        "dialect-mismatch",
        `Dialect extension belongs to "${extensionDialect}" but snapshot dialect is "${dialect}"`,
        [...path, "dialect"],
      ),
    )
  }

  if (extensionDialect === undefined || version === undefined || data === undefined) {
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
        issue("invalid-value", "Non-finite JSON numbers must use a tagged value", path),
      )
    }

    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value !== "object") {
    diagnostics.push(issue("invalid-value", "Snapshot data contains an unsupported value", path))
    return undefined
  }

  if (seen.has(value)) {
    diagnostics.push(issue("invalid-value", "Snapshot data cannot be cyclic", path))
    return undefined
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const result: SnapshotJsonValue[] = []

      for (const [index, item] of value.entries()) {
        const child = validateJsonValue(item, [...path, index], diagnostics, seen)

        if (child !== undefined) {
          result.push(child)
        }
      }

      return result
    }

    if (!isRecord(value)) {
      diagnostics.push(issue("invalid-value", "Snapshot data must use plain objects", path))
      return undefined
    }

    if (Object.keys(value).length === 1 && "$bigint" in value) {
      if (typeof value.$bigint !== "string" || !isCanonicalNumber(value.$bigint, true)) {
        diagnostics.push(
          issue("invalid-value", "Tagged bigint is not canonical", [...path, "$bigint"]),
        )
      }

      return typeof value.$bigint === "string" && isCanonicalNumber(value.$bigint, true)
        ? { $bigint: value.$bigint }
        : undefined
    }

    if (Object.keys(value).length === 1 && "$number" in value) {
      if (
        value.$number !== "NaN" &&
        value.$number !== "Infinity" &&
        value.$number !== "-Infinity"
      ) {
        diagnostics.push(issue("invalid-value", "Tagged number is invalid", [...path, "$number"]))
      }

      return value.$number === "NaN" ||
        value.$number === "Infinity" ||
        value.$number === "-Infinity"
        ? { $number: value.$number }
        : undefined
    }

    const result: Record<string, SnapshotJsonValue> = {}

    for (const key of Object.keys(value).sort()) {
      const child = validateJsonValue(value[key], [...path, key], diagnostics, seen)

      if (child !== undefined) {
        result[key] = child
      }
    }

    return result
  } finally {
    seen.delete(value)
  }
}

function validateObjectReference(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotObjectReference | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Object reference must be an object", path))
    return undefined
  }

  requireKeys(value, ["kind", "id"], path, diagnostics)
  const kind = stringValue(value.kind, [...path, "kind"], diagnostics, true)
  const id = stringValue(value.id, [...path, "id"], diagnostics, true)

  if (kind === "namespace") {
    diagnostics.push(
      issue("invalid-snapshot", "Object references cannot target a namespace", [...path, "kind"]),
    )
  }

  if (kind !== undefined && !completeObjectKinds.has(kind)) {
    diagnostics.push(
      issue("invalid-snapshot", `Unknown object reference kind: ${kind}`, [...path, "kind"]),
    )
  }

  return kind === undefined ||
    id === undefined ||
    !completeObjectKinds.has(kind) ||
    kind === "namespace"
    ? undefined
    : {
        kind: kind as CompleteSnapshotObjectReference["kind"],
        id,
      }
}

function validateReferences(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): readonly CompleteSnapshotObjectReference[] | undefined {
  return validateArray(value, path, diagnostics, validateObjectReference)
}

function validateForeignKeyTarget(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): CompleteSnapshotForeignKey["target"] | undefined {
  if (!isRecord(value)) {
    diagnostics.push(issue("invalid-snapshot", "Foreign-key target must be an object", path))
    return undefined
  }

  requireKeys(value, ["table", "columns"], path, diagnostics)
  const table = validateObjectReference(value.table, [...path, "table"], diagnostics)
  const columns = validateIds(value.columns, [...path, "columns"], diagnostics)

  return table === undefined || columns === undefined
    ? undefined
    : {
        table,
        columns,
      }
}

function validateIds(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  nonEmpty = true,
): readonly string[] | undefined {
  const result = validateStrings(value, path, diagnostics, nonEmpty)

  if (result === undefined) {
    return undefined
  }

  const seen = new Set<string>()

  for (const [index, id] of result.entries()) {
    if (seen.has(id)) {
      diagnostics.push(
        issue("non-canonical", "References cannot contain duplicate IDs", [...path, index]),
      )
    }

    seen.add(id)
  }

  return result
}

function validateStrings(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  nonEmpty: boolean,
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(issue("invalid-snapshot", "Value must be an array", path))
    return undefined
  }

  const result: string[] = []

  for (const [index, item] of value.entries()) {
    const string = stringValue(item, [...path, index], diagnostics, nonEmpty)

    if (string !== undefined) {
      result.push(string)
    }
  }

  if (nonEmpty && result.length === 0) {
    diagnostics.push(issue("invalid-snapshot", "Array cannot be empty", path))
  }

  return result
}

function validateArray<T>(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  validate: (
    value: unknown,
    path: readonly (string | number)[],
    diagnostics: SnapshotDiagnostic[],
  ) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(issue("invalid-snapshot", "Value must be an array", path))
    return undefined
  }

  const result: T[] = []

  for (const [index, item] of value.entries()) {
    const child = validate(item, [...path, index], diagnostics)

    if (child !== undefined) {
      result.push(child)
    }
  }

  return result
}

function validateTiming(
  value: Record<string, unknown>,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  const deferrable = optionalBoolean(value.deferrable, [...path, "deferrable"], diagnostics)
  const initially = validateChoice(
    value.initially,
    ["immediate", "deferred"] as const,
    [...path, "initially"],
    diagnostics,
  )

  return {
    ...(deferrable === undefined ? {} : { deferrable }),
    ...(initially === undefined ? {} : { initially }),
  }
}

function validateAction(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(
    value,
    ["no-action", "restrict", "cascade", "set-null", "set-default"] as const,
    path,
    diagnostics,
  )
}

function validateMatch(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(value, ["simple", "full", "partial"] as const, path, diagnostics)
}

function validateNulls(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(value, ["distinct", "not-distinct"] as const, path, diagnostics)
}

function validateDirection(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(value, ["ASC", "DESC"] as const, path, diagnostics)
}

function validateIndexNulls(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(value, ["FIRST", "LAST"] as const, path, diagnostics)
}

function validateCheckOption(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(value, ["none", "local", "cascaded"] as const, path, diagnostics)
}

function validateTimingKind(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(
    value,
    ["before", "after", "instead-of", "unknown"] as const,
    path,
    diagnostics,
  )
}

function validateOrientation(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(value, ["row", "statement"] as const, path, diagnostics)
}

function validateRoutineKind(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
) {
  return validateChoice(
    value,
    ["function", "procedure", "aggregate", "window", "unknown"] as const,
    path,
    diagnostics,
  )
}

function validateEvents(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): readonly ("insert" | "update" | "delete" | "truncate")[] | undefined {
  const events = validateStrings(value, path, diagnostics, true)

  if (events === undefined) {
    return undefined
  }

  const allowed = new Set(["insert", "update", "delete", "truncate"])
  const result: ("insert" | "update" | "delete" | "truncate")[] = []

  for (const [index, event] of events.entries()) {
    if (!allowed.has(event)) {
      diagnostics.push(issue("invalid-snapshot", "Trigger event is invalid", [...path, index]))
    } else {
      result.push(event as "insert" | "update" | "delete" | "truncate")
    }
  }

  const sorted = [...result].sort()

  if (sorted.some((event, index) => event !== result[index])) {
    diagnostics.push(issue("non-canonical", "Trigger events must be sorted", path))
  }

  return result
}

function validatePath(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): readonly (string | number)[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(issue("invalid-snapshot", "Provenance path must be an array", path))
    return undefined
  }

  const result: (string | number)[] = []

  for (const [index, part] of value.entries()) {
    if (
      (typeof part !== "string" && typeof part !== "number") ||
      (typeof part === "number" && !Number.isSafeInteger(part))
    ) {
      diagnostics.push(
        issue("invalid-snapshot", "Provenance path parts must be strings or safe integers", [
          ...path,
          index,
        ]),
      )
    } else {
      result.push(part)
    }
  }

  return result
}

function validateChoice<const T extends string>(
  value: unknown,
  choices: readonly T[],
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): T | undefined {
  if (value === undefined) {
    return undefined
  }

  if (choices.includes(value as T)) {
    return value as T
  }

  diagnostics.push(issue("invalid-snapshot", `Value must be one of ${choices.join(", ")}`, path))
  return undefined
}

function stringValue(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  nonEmpty = false,
): string | undefined {
  if (typeof value !== "string" || (nonEmpty && value.length === 0)) {
    diagnostics.push(
      issue(
        "invalid-snapshot",
        nonEmpty ? "Value must be a non-empty string" : "Value must be a string",
        path,
      ),
    )
    return undefined
  }

  return value
}

function integerValue(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    diagnostics.push(issue("invalid-snapshot", "Value must be a safe integer", path))
    return undefined
  }

  return value
}

function booleanValue(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    diagnostics.push(issue("invalid-snapshot", "Value must be boolean", path))
    return undefined
  }

  return value
}

function optionalBoolean(
  value: unknown,
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): boolean | undefined {
  return value === undefined ? undefined : booleanValue(value, path, diagnostics)
}

function isCanonicalNumber(value: string, integer: boolean): boolean {
  return integer
    ? /^(?:0|-[1-9]\d*|[1-9]\d*)$/u.test(value)
    : /^(?:0|-?(?:[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|0(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u.test(value)
}

const completeObjectKinds = new Set<string>([
  "table",
  "column",
  "constraint",
  "index",
  "view",
  "materialized-view",
  "sequence",
  "enum",
  "domain",
  "collation",
  "trigger",
  "routine",
  "partition",
  "policy",
  "extension",
  "comment",
  "ownership",
  "deferred-object",
  "opaque-object",
])

function validateCompleteDialectMetadata(
  snapshot: CompleteSchemaSnapshot,
  diagnostics: SnapshotDiagnostic[],
): void {
  const dialect = snapshot.dialect.name
  const objects = [
    ...snapshot.tables,
    ...snapshot.views,
    ...snapshot.sequences,
    ...snapshot.enums,
    ...snapshot.domains,
    ...snapshot.collations,
    ...snapshot.triggers,
    ...snapshot.routines,
    ...snapshot.partitions,
    ...snapshot.policies,
    ...snapshot.extensions,
    ...snapshot.deferredObjects,
    ...snapshot.opaqueObjects,
    ...snapshot.comments,
    ...snapshot.ownership,
  ]

  for (const object of objects) {
    if (object.dialect?.dialect !== undefined && object.dialect.dialect !== dialect) {
      diagnostics.push(
        issue(
          "dialect-mismatch",
          `Dialect extension belongs to "${object.dialect.dialect}" but snapshot dialect is "${dialect}"`,
          [object.kind, object.id, "dialect", "dialect"],
        ),
      )
    }

    if (object.provenance?.dialect !== undefined && object.provenance.dialect !== dialect) {
      diagnostics.push(
        issue(
          "dialect-mismatch",
          `Provenance belongs to "${object.provenance.dialect}" but snapshot dialect is "${dialect}"`,
          [object.kind, object.id, "provenance", "dialect"],
        ),
      )
    }
  }

  walkCompleteMetadata(snapshot, [], dialect, diagnostics)
}

function walkCompleteMetadata(
  value: unknown,
  path: readonly (string | number)[],
  dialect: string,
  diagnostics: SnapshotDiagnostic[],
  seen = new WeakSet<object>(),
): void {
  if (value === null || typeof value !== "object") {
    return
  }

  if (seen.has(value)) {
    return
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) {
        walkCompleteMetadata(child, [...path, index], dialect, diagnostics, seen)
      }

      return
    }

    if (!isRecord(value)) {
      return
    }

    if (
      value.kind === "expression" &&
      typeof value.dialect === "string" &&
      value.dialect !== dialect
    ) {
      diagnostics.push(
        issue(
          "dialect-mismatch",
          `Expression belongs to "${value.dialect}" but snapshot dialect is "${dialect}"`,
          [...path, "dialect"],
        ),
      )
    }

    if (value.kind === "native" && typeof value.dialect === "string" && value.dialect !== dialect) {
      diagnostics.push(
        issue(
          "dialect-mismatch",
          `Native storage belongs to "${value.dialect}" but snapshot dialect is "${dialect}"`,
          [...path, "dialect"],
        ),
      )
    }

    for (const [key, child] of Object.entries(value)) {
      if (key !== "data") {
        walkCompleteMetadata(child, [...path, key], dialect, diagnostics, seen)
      }
    }
  } finally {
    seen.delete(value)
  }
}

function validateCompleteCrossReferences(
  snapshot: CompleteSchemaSnapshot,
  diagnostics: SnapshotDiagnostic[],
): void {
  const objects = new Map<string, CompleteSnapshotObject>()
  const add = (object: CompleteSnapshotObject): void => {
    const kind = object.kind as string

    objects.set(referenceKey(kind, object.id), object)
    if (
      kind === "primary-key" ||
      kind === "unique" ||
      kind === "unique-constraint" ||
      kind === "foreign-key" ||
      kind === "check"
    ) {
      objects.set(referenceKey("constraint", object.id), object)
    }
  }

  for (const table of snapshot.tables) {
    add(table)
    for (const column of table.columns) {
      add(column as unknown as CompleteSnapshotObject)
    }

    for (const constraint of table.constraints) {
      add(constraint as unknown as CompleteSnapshotObject)
    }

    for (const index of table.indexes) {
      add(index as unknown as CompleteSnapshotObject)
    }
  }

  for (const group of [
    snapshot.views,
    snapshot.sequences,
    snapshot.enums,
    snapshot.domains,
    snapshot.collations,
    snapshot.triggers,
    snapshot.routines,
    snapshot.partitions,
    snapshot.policies,
    snapshot.extensions,
    snapshot.deferredObjects,
    snapshot.opaqueObjects,
    snapshot.comments,
    snapshot.ownership,
  ]) {
    for (const object of group) {
      add(object as CompleteSnapshotObject)
    }
  }

  for (const view of snapshot.views) {
    for (const column of view.columns) {
      add(column as unknown as CompleteSnapshotObject)
    }
  }

  const requireReference = (
    reference: CompleteSnapshotObjectReference,
    path: readonly (string | number)[],
    expected?: CompleteSnapshotObjectReference["kind"],
  ): void => {
    if (expected !== undefined && reference.kind !== expected) {
      diagnostics.push(
        issue("invalid-cross-reference", `Reference must target a ${expected}`, path),
      )
    }

    if (!objects.has(referenceKey(reference.kind, reference.id))) {
      diagnostics.push(
        issue(
          "invalid-cross-reference",
          `Referenced ${reference.kind} "${reference.id}" does not exist`,
          path,
        ),
      )
    }
  }

  for (const [tableIndex, table] of snapshot.tables.entries()) {
    const columns = new Set(table.columns.map((column) => column.id))

    for (const [constraintIndex, constraint] of table.constraints.entries()) {
      if (constraint.kind !== "check") {
        for (const [columnIndex, column] of constraint.columns.entries()) {
          if (!columns.has(column)) {
            diagnostics.push(
              issue(
                "invalid-cross-reference",
                `Constraint column "${column}" is not declared on table "${table.id}"`,
                ["tables", tableIndex, "constraints", constraintIndex, "columns", columnIndex],
              ),
            )
          }
        }
      }

      if (constraint.kind === "foreign-key") {
        requireReference(
          constraint.target.table,
          ["tables", tableIndex, "constraints", constraintIndex, "target", "table"],
          "table",
        )
        const target = objects.get(
          referenceKey(constraint.target.table.kind, constraint.target.table.id),
        )

        if (target?.kind === "table") {
          const targetColumns = new Set(target.columns.map((column) => column.id))

          for (const [columnIndex, column] of constraint.target.columns.entries()) {
            if (!targetColumns.has(column)) {
              diagnostics.push(
                issue(
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

      if (
        constraint.kind !== "foreign-key" &&
        "backingIndex" in constraint &&
        constraint.backingIndex !== undefined
      ) {
        requireReference(
          constraint.backingIndex,
          ["tables", tableIndex, "constraints", constraintIndex, "backingIndex"],
          "index",
        )
      }
    }

    for (const [indexIndex, index] of table.indexes.entries()) {
      for (const [termIndex, term] of index.terms.entries()) {
        if (term.kind === "column" && !columns.has(term.column)) {
          diagnostics.push(
            issue(
              "invalid-cross-reference",
              `Index column "${term.column}" is not declared on table "${table.id}"`,
              ["tables", tableIndex, "indexes", indexIndex, "terms", termIndex, "column"],
            ),
          )
        }
      }

      for (const [columnIndex, column] of (index.includedColumns ?? []).entries()) {
        if (!columns.has(column)) {
          diagnostics.push(
            issue(
              "invalid-cross-reference",
              `Included index column "${column}" is not declared on table "${table.id}"`,
              ["tables", tableIndex, "indexes", indexIndex, "includedColumns", columnIndex],
            ),
          )
        }
      }

      if (index.backingConstraint !== undefined) {
        requireReference(
          index.backingConstraint,
          ["tables", tableIndex, "indexes", indexIndex, "backingConstraint"],
          "constraint",
        )
      }
    }
  }

  for (const [index, sequence] of snapshot.sequences.entries()) {
    if (sequence.ownedBy !== undefined) {
      requireReference(sequence.ownedBy, ["sequences", index, "ownedBy"])
    }
  }

  for (const [index, view] of snapshot.views.entries()) {
    for (const [dependency, reference] of (view.dependencies ?? []).entries()) {
      requireReference(reference, ["views", index, "dependencies", dependency])
    }
  }

  for (const [index, trigger] of snapshot.triggers.entries()) {
    requireReference(trigger.table, ["triggers", index, "table"])
  }

  for (const [index, routine] of snapshot.routines.entries()) {
    for (const [dependency, reference] of (routine.dependencies ?? []).entries()) {
      requireReference(reference, ["routines", index, "dependencies", dependency])
    }
  }

  for (const [index, partition] of snapshot.partitions.entries()) {
    requireReference(partition.parent, ["partitions", index, "parent"], "table")
  }

  for (const [index, policy] of snapshot.policies.entries()) {
    requireReference(policy.table, ["policies", index, "table"], "table")
  }

  for (const [index, comment] of snapshot.comments.entries()) {
    requireReference(comment.object, ["comments", index, "object"])
  }

  for (const [index, ownership] of snapshot.ownership.entries()) {
    requireReference(ownership.object, ["ownership", index, "object"])
  }
}

function referenceKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`
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
        issue("non-canonical", "Entities must be sorted by stable logical ID", [
          ...path,
          index,
          "id",
        ]),
      )
    }

    previous = item.id
  }
}

function validateSortedPositions(
  value: readonly {
    readonly ordinalPosition?: number
    readonly position?: number
  }[],
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
): void {
  let previous: number | undefined

  for (const [index, item] of value.entries()) {
    const position = item.position ?? item.ordinalPosition

    if (position !== undefined && previous !== undefined && position <= previous) {
      diagnostics.push(
        issue(
          "non-canonical",
          "Positioned entries must be sorted by strictly increasing position",
          [...path, index, item.position === undefined ? "ordinalPosition" : "position"],
        ),
      )
    }

    if (position !== undefined) {
      previous = position
    }
  }
}

function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: readonly (string | number)[],
  diagnostics: SnapshotDiagnostic[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional])

  for (const key of required) {
    if (!optional.includes(key) && !(key in value)) {
      diagnostics.push(issue("invalid-snapshot", `Missing required field "${key}"`, [...path, key]))
    }
  }

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(issue("unknown-field", `Unknown snapshot field "${key}"`, [...path, key]))
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function issue(
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

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value
  }

  if (seen.has(value)) {
    return value
  }

  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item, seen)
    }
  } else {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, seen)
    }
  }

  return Object.freeze(value)
}
