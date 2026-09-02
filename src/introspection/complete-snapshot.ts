import { hasCandidateKeyShape } from "../snapshot/candidate-key.ts"
import { toSnapshotJsonValue } from "../snapshot/canonical.ts"
import {
  assertCompleteSchemaSnapshot,
  type CompleteSchemaSnapshot,
  type CompleteSnapshotCheckConstraint,
  type CompleteSnapshotColumn,
  type CompleteSnapshotComment,
  type CompleteSnapshotConstraint,
  type CompleteSnapshotDeferredObject,
  type CompleteSnapshotDomain,
  type CompleteSnapshotEnum,
  type CompleteSnapshotExtension,
  type CompleteSnapshotIdentity,
  type CompleteSnapshotIndex,
  type CompleteSnapshotIndexTerm,
  type CompleteSnapshotObjectOwner,
  type CompleteSnapshotObjectReference,
  type CompleteSnapshotObjectMetadata,
  type CompleteSnapshotOpaqueObject,
  type CompleteSnapshotOwnership,
  type CompleteSnapshotPartition,
  type CompleteSnapshotPolicy,
  type CompleteSnapshotRoutine,
  type CompleteSnapshotRoutineParameter,
  type CompleteSnapshotSequence,
  type CompleteSnapshotTable,
  type CompleteSnapshotTrigger,
  type CompleteSnapshotValueFact,
  type CompleteSnapshotView,
} from "../snapshot/index.ts"
import { storageAffinity } from "../snapshot/sqlite.ts"
import { createCompleteIntrospectionCatalog } from "./catalog.ts"
import { createIntrospectionDiagnostic, type IntrospectionDiagnostic } from "./diagnostics.ts"
import {
  introspectedPhysicalIdentityPolicy,
  type CatalogIdentityEntityKind,
  type CatalogIdentityHint,
  type CatalogIdentityPolicy,
  type CatalogIdentitySource,
  type CatalogResolvedIdentity,
} from "./identity.ts"
import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogDialectExtension,
  CatalogDomain,
  CatalogEntityReference,
  CatalogEnum,
  CatalogExtensionObject,
  CatalogIndex,
  CatalogLiteralFact,
  CatalogObjectBase,
  CatalogObjectOwner,
  CatalogObjectReference,
  CatalogOpaqueObject,
  CatalogPartition,
  CatalogPolicy,
  CatalogProvenance,
  CatalogReference,
  CatalogRoutine,
  CatalogSequence,
  CatalogSqlExpression,
  CatalogTable,
  CatalogTrigger,
  CatalogUnknownField,
  CatalogValueFact,
  CatalogView,
  CompleteIntrospectionCatalog,
  IntrospectionMode,
  IntrospectionCatalog,
  IntrospectionOptions,
} from "./types.ts"

/** Result returned by the normalized-catalog-to-Snapshot v1 mapper, including lossiness status. */
export type CompleteSnapshotMappingResult =
  | {
      readonly ok: true
      readonly catalog: CompleteIntrospectionCatalog
      readonly snapshot: CompleteSchemaSnapshot
      readonly diagnostics: readonly IntrospectionDiagnostic[]
      readonly lossy: false
    }
  | {
      readonly ok: true
      readonly catalog: CompleteIntrospectionCatalog
      readonly snapshot: CompleteSchemaSnapshot
      readonly diagnostics: readonly IntrospectionDiagnostic[]
      readonly lossy: true
    }
  | {
      readonly ok: false
      readonly catalog: CompleteIntrospectionCatalog
      readonly diagnostics: readonly IntrospectionDiagnostic[]
      readonly lossy: false
    }

/**
 * Map a normalized catalog to validated Snapshot v1 data.
 *
 * Strict mode reports mapping errors as failure. Explicit lossy mode may omit only recoverable
 * unsafe facts and marks a successful result as lossy. Complete objects are never fabricated as
 * tables, and catalog references remain evidence rather than logical IDs.
 */
export function mapCatalogToCompleteSnapshot(
  input: IntrospectionCatalog,
  options?: IntrospectionOptions,
): CompleteSnapshotMappingResult {
  // Rewrite identities before normalization so every object and relationship is mapped from one
  // consistent logical-ID graph.
  const catalog = createCompleteIntrospectionCatalog(applyIdentityOptions(input, options))
  const normalizedDiagnostics = normalizeCatalogDiagnostics(
    catalog.diagnostics,
    options?.mode ?? "strict",
  )
  const context: MappingContext = {
    mode: options?.mode ?? "strict",
    diagnostics: normalizedDiagnostics.diagnostics,
    lossy: normalizedDiagnostics.lossy,
    references: createCatalogReferenceLookup(catalog),
  }
  const tableByPhysicalName = new Map(catalog.tables.map((table) => [table.physicalName, table]))
  const tables = catalog.tables.map((table) =>
    mapTable(table, catalog.dialect, tableByPhysicalName, context),
  )
  const views = catalog.views.map((view, index) =>
    mapView(view, catalog.dialect, context, ["views", index]),
  )
  const sequences = catalog.sequences
    .map((sequence, index) => mapSequence(sequence, catalog.dialect, context, ["sequences", index]))
    .filter((sequence): sequence is CompleteSnapshotSequence => sequence !== undefined)
  const enums = catalog.enums.map((item) => mapEnum(item, catalog.dialect))
  const domains = catalog.domains.map((domain) => mapDomain(domain, catalog.dialect))
  const collations = catalog.collations.map((collation) => ({
    kind: "collation" as const,
    id: collation.id,
    physicalName: collation.physicalName,
    ...(collation.provider === undefined ? {} : { provider: collation.provider }),
    ...(collation.locale === undefined ? {} : { locale: collation.locale }),
    ...(collation.deterministic === undefined ? {} : { deterministic: collation.deterministic }),
    ...(collation.version === undefined ? {} : { version: collation.version }),
    ...mapMetadata(collation.provenance, collation.dialect, catalog.dialect, collation.reference),
  }))
  const triggers = catalog.triggers.map((trigger, index) =>
    mapTrigger(trigger, catalog.dialect, context, ["triggers", index]),
  )
  const routines = catalog.routines.map((routine, index) =>
    mapRoutine(routine, catalog.dialect, context, ["routines", index]),
  )
  const partitions = catalog.partitions.map((partition, index) =>
    mapPartition(partition, catalog.dialect, context, ["partitions", index]),
  )
  const policies = catalog.policies.map((policy, index) =>
    mapPolicy(policy, catalog.dialect, context, ["policies", index]),
  )
  const extensions = catalog.extensionObjects.map((extension) =>
    mapExtensionObject(extension, catalog.dialect),
  )
  const deferredObjects = catalog.deferredObjects.map((object) =>
    mapDeferredObject(object, catalog.dialect),
  )
  const opaqueObjects = catalog.opaqueObjects.map((object) =>
    mapOpaqueObject(object, catalog.dialect),
  )

  for (const object of catalogObjectsWithUnknownFields(catalog)) {
    for (const field of object.unknownFields ?? []) {
      opaqueObjects.push(mapUnknownField(object, field, catalog.dialect))
    }
  }

  const comments = (catalog.comments ?? [])
    .map((comment, index) => mapComment(comment, catalog.dialect, context, ["comments", index]))
    .filter((comment): comment is CompleteSnapshotComment => comment !== undefined)
  const ownership = (catalog.ownership ?? [])
    .map((item, index) => mapOwnership(item, catalog.dialect, context, ["ownership", index]))
    .filter((item): item is CompleteSnapshotOwnership => item !== undefined)

  // Keep direct metadata comments/owners visible even when a reader attached
  // them to an object instead of populating the catalog-level collections.
  for (const object of catalogObjectList(catalog)) {
    if (object.comment && !comments.some((item) => item.id === object.comment?.id)) {
      const comment = mapComment(
        object.comment,
        catalog.dialect,
        context,
        ["comments"],
        object.ownerScope,
      )

      if (comment !== undefined) {
        comments.push(comment)
      }
    }

    if (object.ownership && !ownership.some((item) => item.id === object.ownership?.id)) {
      const ownershipRecord = mapOwnership(object.ownership, catalog.dialect, context, [
        "ownership",
      ], object.ownerScope)

      if (ownershipRecord !== undefined) {
        ownership.push(ownershipRecord)
      }
    }
  }

  const snapshot: CompleteSchemaSnapshot = {
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: catalog.dialect,
      version: 1,
    },
    namingPolicy: {
      name: (options?.identityPolicy ?? introspectedPhysicalIdentityPolicy).name,
      version: (options?.identityPolicy ?? introspectedPhysicalIdentityPolicy).version,
    },
    namespace: {
      kind: catalog.namespace.kind,
      name: catalog.namespace.name,
      ...mapMetadata(
        catalog.namespace.provenance,
        catalog.namespace.dialect,
        catalog.dialect,
        catalog.namespace.reference,
      ),
    },
    capabilities: catalog.capabilities,
    tables: tables.sort(compareId),
    views: views.sort(compareId),
    sequences: sequences.sort(compareId),
    enums: enums.sort(compareId),
    domains: domains.sort(compareId),
    collations: collations.sort(compareId),
    triggers: triggers
      .filter((trigger): trigger is CompleteSnapshotTrigger => trigger !== undefined)
      .sort(compareId),
    routines: routines
      .filter((routine): routine is CompleteSnapshotRoutine => routine !== undefined)
      .sort(compareId),
    partitions: partitions
      .filter((partition): partition is CompleteSnapshotPartition => partition !== undefined)
      .sort(compareId),
    policies: policies
      .filter((policy): policy is CompleteSnapshotPolicy => policy !== undefined)
      .sort(compareId),
    extensions: extensions.sort(compareId),
    deferredObjects: deferredObjects.sort(compareId),
    opaqueObjects: opaqueObjects.sort(compareId),
    comments: comments.sort(compareId),
    ownership: ownership.sort(compareId),
  }

  let validatedSnapshot: CompleteSchemaSnapshot

  try {
    validatedSnapshot = assertCompleteSchemaSnapshot(snapshot)
  } catch (error) {
    context.diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "invalid-catalog-row",
        message:
          error instanceof Error
            ? `Catalog facts could not form Snapshot v1: ${error.message}`
            : "Catalog facts could not form Snapshot v1",
        path: [],
        remediation: "Inspect the catalog diagnostics and complete object mappings.",
      }),
    )
    return Object.freeze({
      ok: false as const,
      catalog,
      diagnostics: Object.freeze(context.diagnostics),
      lossy: false as const,
    })
  }

  if (context.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return Object.freeze({
      ok: false as const,
      catalog,
      diagnostics: Object.freeze(context.diagnostics),
      lossy: false as const,
    })
  }

  const diagnostics = Object.freeze(context.diagnostics)

  if (context.lossy) {
    return Object.freeze({
      ok: true as const,
      catalog,
      snapshot: validatedSnapshot,
      diagnostics,
      lossy: true as const,
    })
  }

  return Object.freeze({
    ok: true as const,
    catalog,
    snapshot: validatedSnapshot,
    diagnostics,
    lossy: false as const,
  })
}

/** Numbered alias for callers that prefer the explicit Snapshot v1 mapper name. */
export const mapCatalogToSnapshotV1 = mapCatalogToCompleteSnapshot

function applyIdentityOptions(
  input: IntrospectionCatalog,
  options: IntrospectionOptions | undefined,
): IntrospectionCatalog {
  if (
    options?.identityHints === undefined &&
    options?.previousSnapshot === undefined &&
    options?.identityPolicy === undefined
  ) {
    return input
  }

  const policy = options?.identityPolicy ?? introspectedPhysicalIdentityPolicy
  const identityDiagnostics: IntrospectionDiagnostic[] = []
  const previous = selectPreviousSnapshot(
    input,
    options?.previousSnapshot,
    options?.namespace ?? input.namespace.name,
    identityDiagnostics,
  )
  // Resolve the complete identity graph before rewriting objects so cross-object references use
  // the same selected IDs as their targets.
  const entries = collectIdentityEntries(input)
  const previousIndex = previous === undefined ? undefined : collectPreviousIdentities(previous)
  const resolver = createIdentityResolver(
    entries,
    options?.identityHints ?? [],
    previousIndex,
    policy,
    identityDiagnostics,
  )

  return rewriteCatalog(input, resolver, identityDiagnostics)
}

interface MappingContext {
  readonly mode: IntrospectionMode
  readonly diagnostics: IntrospectionDiagnostic[]
  readonly references: CatalogReferenceLookup
  lossy: boolean
}

interface CatalogReferenceLookup {
  has(reference: CatalogObjectReference | CatalogEntityReference): boolean
  owner(reference: CatalogObjectReference | CatalogEntityReference): CatalogObjectOwner | undefined
}

interface IdentityEntry {
  readonly object: object
  readonly kind: CatalogIdentityEntityKind
  readonly currentId: string
  readonly physicalName: string
  readonly physicalIdentityName: string
  readonly scopePhysicalName?: string
  readonly scopeId?: string
}

interface PreviousIdentity {
  readonly kind: CatalogIdentityEntityKind
  readonly id: string
  readonly physicalName: string
  readonly scopePhysicalName?: string
}

interface ResolvedReference {
  readonly object: object
  readonly identity: CatalogResolvedIdentity
}

interface IdentityResolver {
  forObject(object: object): CatalogResolvedIdentity | undefined
  resolveReference(kind: string, id: string, scopeId?: string): CatalogResolvedIdentity | undefined
}

function normalizeCatalogDiagnostics(
  diagnostics: readonly IntrospectionDiagnostic[],
  mode: IntrospectionMode,
): {
  readonly diagnostics: IntrospectionDiagnostic[]
  readonly lossy: boolean
} {
  const normalized: IntrospectionDiagnostic[] = []
  let lossy = false

  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "lossy-mapping") {
      lossy = true
    }

    if (mode === "lossy" && isRecoverableMappingDiagnostic(diagnostic)) {
      lossy = true
      normalized.push(
        createIntrospectionDiagnostic({
          ...diagnostic,
          severity: "warning",
          code: "lossy-mapping",
          message: `Lossy mapping omitted an unsafe catalog fact: ${diagnostic.message}`,
        }),
      )
    } else {
      normalized.push(diagnostic)
    }
  }

  return {
    diagnostics: normalized,
    lossy,
  }
}

function isRecoverableMappingDiagnostic(diagnostic: IntrospectionDiagnostic): boolean {
  if (diagnostic.severity !== "error") {
    return false
  }

  if (
    diagnostic.code === "unresolved-reference" ||
    diagnostic.code === "expression-parse-failed" ||
    diagnostic.code === "unsupported-feature" ||
    diagnostic.code === "ambiguous-identity"
  ) {
    return true
  }

  return diagnostic.code === "dialect-mismatch" && diagnostic.path[0] === "previousSnapshot"
}

function reportMappingIssue(
  context: MappingContext,
  input: Omit<IntrospectionDiagnostic, "severity">,
  recoverable = true,
): boolean {
  // A true result means lossy mode omitted the unsafe fact; strict mode keeps it while the
  // accumulated diagnostic rejects the mapping.
  if (context.mode === "lossy" && recoverable) {
    context.lossy = true
    context.diagnostics.push(
      createIntrospectionDiagnostic({
        ...input,
        severity: "warning",
        code: "lossy-mapping",
        message: `Lossy mapping omitted an unsafe catalog fact: ${input.message}`,
      }),
    )
    return true
  }

  context.diagnostics.push(
    createIntrospectionDiagnostic({
      ...input,
      severity: "error",
    }),
  )
  return false
}

function createCatalogReferenceLookup(
  catalog: CompleteIntrospectionCatalog,
): CatalogReferenceLookup {
  const keys = new Set<string>()
  const scopedKeys = new Set<string>()
  const inferredOwners = new Map<string, CatalogObjectOwner | null>()
  const add = (kind: string, id: string) => keys.add(referenceKey(kind, id))
  const addScoped = (
    kind: string,
    id: string,
    ownerKind: CatalogObjectOwner["kind"],
    ownerId: string,
  ) => {
    add(kind, id)
    scopedKeys.add(referenceKey(`${kind}:${ownerKind}:${ownerId}`, id))

    const key = referenceKey(normalizeReferenceKind(kind), id)
    const owner = { kind: ownerKind, id: ownerId }
    const existing = inferredOwners.get(key)

    inferredOwners.set(
      key,
      existing === undefined
        ? owner
        : existing === null || existing.kind !== owner.kind || existing.id !== owner.id
          ? null
          : existing,
    )
  }

  add("namespace", catalog.namespace.name)
  for (const table of catalog.tables) {
    add("table", table.id)
    for (const column of table.columns) {
      addScoped("column", column.id, "table", table.id)
    }

    for (const constraint of table.constraints) {
      addScoped("constraint", constraint.id, "table", table.id)
      addScoped(constraint.kind, constraint.id, "table", table.id)
    }

    for (const index of table.indexes) {
      addScoped("index", index.id, "table", table.id)
    }
  }

  for (const view of catalog.views) {
    add(view.kind, view.id)
    for (const column of view.columns) {
      addScoped("column", column.id, view.kind, view.id)
    }
  }

  for (const sequence of catalog.sequences) {
    add("sequence", sequence.id)
  }

  for (const item of catalog.enums) {
    add("enum", item.id)
  }

  for (const domain of catalog.domains) {
    add("domain", domain.id)
    for (const constraint of domain.constraints ?? []) {
      addScoped("constraint", constraint.id, "domain", domain.id)
      addScoped("check", constraint.id, "domain", domain.id)
    }
  }

  for (const collation of catalog.collations) {
    add("collation", collation.id)
  }

  for (const trigger of catalog.triggers) {
    add("trigger", trigger.id)
  }

  for (const routine of catalog.routines) {
    add("routine", routine.id)
  }

  for (const partition of catalog.partitions) {
    add("partition", partition.id)
  }

  for (const policy of catalog.policies) {
    add("policy", policy.id)
  }

  for (const extension of catalog.extensionObjects) {
    add("extension", extension.id)
  }

  for (const object of catalog.deferredObjects) {
    add("deferred-object", object.id ?? `deferred:${object.objectKind}:${object.physicalName}`)
  }

  for (const object of catalog.opaqueObjects) {
    add("opaque-object", object.id)
  }

  for (const comment of catalog.comments) {
    add("comment", comment.id)
  }

  for (const ownership of catalog.ownership) {
    add("ownership", ownership.id)
  }

  return {
    // Column, constraint, and index IDs may repeat across tables; scoped references must not
    // resolve to a same-named entity owned by another table.
    has(reference) {
      if (!keys.has(referenceKey(reference.kind, reference.id))) {
        return false
      }

      const owner =
        reference.owner ??
        (isEntityReference(reference) && reference.tableId !== undefined
          ? { kind: "table" as const, id: reference.tableId }
          : undefined)

      if (owner === undefined) {
        return true
      }

      return scopedKeys.has(
        referenceKey(
          `${normalizeReferenceKind(reference.kind)}:${owner.kind}:${owner.id}`,
          reference.id,
        ),
      )
    },
    owner(reference) {
      const owner = inferredOwners.get(
        referenceKey(normalizeReferenceKind(reference.kind), reference.id),
      )

      return owner === null ? undefined : owner
    },
  }
}

function isEntityReference(
  reference: CatalogObjectReference | CatalogEntityReference,
): reference is CatalogEntityReference {
  return "tableId" in reference
}

function referenceKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`
}

function selectPreviousSnapshot(
  input: IntrospectionCatalog,
  previous: IntrospectionOptions["previousSnapshot"],
  selectedNamespace: string,
  diagnostics: IntrospectionDiagnostic[],
) {
  if (previous === undefined) {
    return undefined
  }

  const dialectMatches = previous.dialect.name === input.dialect
  const namespaceMatches =
    previous.namespace.kind === input.namespace.kind &&
    previous.namespace.name === selectedNamespace &&
    input.namespace.name === selectedNamespace

  if (!dialectMatches || !namespaceMatches) {
    diagnostics.push(
      createIntrospectionDiagnostic({
        severity: "error",
        code: "dialect-mismatch",
        message: !dialectMatches
          ? `Previous snapshot dialect ${previous.dialect.name} does not match ${input.dialect}`
          : `Previous snapshot namespace ${previous.namespace.name} does not match ${selectedNamespace}`,
        path: ["previousSnapshot", !dialectMatches ? "dialect" : "namespace"],
        remediation: "Use a previous snapshot from the same dialect and selected namespace.",
      }),
    )
    return undefined
  }

  return previous
}

function collectIdentityEntries(input: IntrospectionCatalog): readonly IdentityEntry[] {
  const entries: IdentityEntry[] = []
  const seen = new Set<object>()

  const add = (
    object: object,
    kind: CatalogIdentityEntityKind,
    currentId: string,
    physicalName: string,
    scopePhysicalName?: string,
    scopeId?: string,
    physicalIdentityName = physicalName,
  ) => {
    if (seen.has(object)) {
      return
    }

    seen.add(object)
    entries.push({
      object,
      kind,
      currentId,
      physicalName,
      physicalIdentityName,
      ...(scopePhysicalName === undefined ? {} : { scopePhysicalName }),
      ...(scopeId === undefined ? {} : { scopeId }),
    })
  }

  for (const table of input.tables) {
    add(table, "table", table.id, table.physicalName)
    for (const column of table.columns) {
      add(column, "column", column.id, column.physicalName, table.physicalName, table.id)
    }

    for (const constraint of table.constraints) {
      add(
        constraint,
        "constraint",
        constraint.id,
        constraint.physicalName ?? constraint.id,
        table.physicalName,
        table.id,
      )
    }

    for (const index of table.indexes) {
      add(index, "index", index.id, index.physicalName ?? index.id, table.physicalName, table.id)
    }
  }

  for (const view of input.views ?? []) {
    add(view, view.kind, view.id, view.physicalName)
    for (const column of view.columns) {
      add(column, "column", column.id, column.physicalName, view.physicalName, view.id)
    }
  }

  for (const sequence of input.sequences ?? []) {
    addObject(sequence, sequence.kind)
  }

  for (const item of input.enums ?? []) {
    addObject(item, item.kind)
  }

  for (const domain of input.domains ?? []) {
    add(domain, "domain", domain.id, domain.physicalName)
    for (const constraint of domain.constraints ?? []) {
      add(
        constraint,
        "constraint",
        constraint.id,
        constraint.physicalName ?? constraint.id,
        domain.physicalName,
        domain.id,
      )
    }
  }

  for (const collation of input.collations ?? []) {
    addObject(collation, collation.kind)
  }

  for (const trigger of input.triggers ?? []) {
    addObject(trigger, trigger.kind)
  }

  for (const routine of input.routines ?? []) {
    addObject(routine, routine.kind)
  }

  for (const partition of input.partitions ?? []) {
    addObject(partition, partition.kind)
  }

  for (const policy of input.policies ?? []) {
    addObject(policy, policy.kind)
  }

  for (const extension of input.extensionObjects ?? []) {
    addObject(extension, extension.kind)
  }

  for (const object of input.opaqueObjects ?? []) {
    addObject(object, object.kind)
  }

  for (const comment of input.comments ?? []) {
    addMetadataObject(comment, "comment")
  }

  for (const ownership of input.ownership ?? []) {
    addMetadataObject(ownership, "ownership")
  }

  const metadataObjects = [
    input.namespace,
    ...input.tables,
    ...(input.views ?? []),
    ...(input.sequences ?? []),
    ...(input.enums ?? []),
    ...(input.domains ?? []),
    ...(input.collations ?? []),
    ...(input.triggers ?? []),
    ...(input.routines ?? []),
    ...(input.partitions ?? []),
    ...(input.policies ?? []),
    ...(input.extensionObjects ?? []),
    ...(input.opaqueObjects ?? []),
    ...input.deferredObjects,
    ...input.tables.flatMap((table) => [...table.columns, ...table.constraints, ...table.indexes]),
    ...(input.views ?? []).flatMap((view) => view.columns),
    ...(input.domains ?? []).flatMap((domain) => domain.constraints ?? []),
  ]

  for (const object of metadataObjects) {
    if (object.comment) {
      addMetadataObject(object.comment, "comment")
    }

    if (object.ownership) {
      addMetadataObject(object.ownership, "ownership")
    }
  }

  return entries

  function addObject(object: CatalogObjectBase, kind: CatalogIdentityEntityKind): void {
    add(object, kind, object.id, object.physicalName)
  }

  function addMetadataObject(
    object: {
      readonly id: string
      readonly reference?: CatalogReference
    },
    kind: "comment" | "ownership",
  ): void {
    add(
      object,
      kind,
      object.id,
      object.reference?.name ?? object.id,
      undefined,
      undefined,
      object.id,
    )
  }
}

function collectPreviousIdentities(
  snapshot: import("../snapshot/types.ts").SchemaSnapshot,
): readonly PreviousIdentity[] {
  const result: PreviousIdentity[] = []
  const add = (
    kind: CatalogIdentityEntityKind,
    id: string,
    physicalName: string,
    scopePhysicalName?: string,
  ) =>
    result.push({
      kind,
      id,
      physicalName,
      ...(scopePhysicalName === undefined ? {} : { scopePhysicalName }),
    })

  for (const table of snapshot.tables) {
    add("table", table.id, table.physicalName)
    for (const column of table.columns) {
      add("column", column.id, column.physicalName, table.physicalName)
    }

    for (const constraint of table.constraints) {
      add("constraint", constraint.id, constraint.physicalName, table.physicalName)
    }

    for (const index of table.indexes) {
      add("index", index.id, index.physicalName, table.physicalName)
    }
  }

  for (const view of snapshot.views) {
    add(view.kind, view.id, view.physicalName)
    for (const column of view.columns) {
      add("column", column.id, column.physicalName, view.physicalName)
    }
  }

  for (const sequence of snapshot.sequences) {
    add("sequence", sequence.id, sequence.physicalName)
  }

  for (const item of snapshot.enums) {
    add("enum", item.id, item.physicalName)
  }

  for (const domain of snapshot.domains) {
    add("domain", domain.id, domain.physicalName)
    for (const constraint of domain.constraints ?? []) {
      add("constraint", constraint.id, constraint.physicalName, domain.physicalName)
    }
  }

  for (const item of snapshot.collations) {
    add("collation", item.id, item.physicalName)
  }

  for (const item of snapshot.triggers) {
    add("trigger", item.id, item.physicalName)
  }

  for (const item of snapshot.routines) {
    add("routine", item.id, item.physicalName)
  }

  for (const item of snapshot.partitions) {
    add("partition", item.id, item.physicalName)
  }

  for (const item of snapshot.policies) {
    add("policy", item.id, item.physicalName)
  }

  for (const item of snapshot.extensions) {
    add("extension", item.id, item.physicalName)
  }

  for (const item of snapshot.opaqueObjects) {
    add("opaque-object", item.id, item.physicalName)
  }

  for (const item of snapshot.comments) {
    add("comment", item.id, item.physicalName)
  }

  for (const item of snapshot.ownership) {
    add("ownership", item.id, item.physicalName)
  }

  return result
}

function createIdentityResolver(
  entries: readonly IdentityEntry[],
  hints: readonly CatalogIdentityHint[],
  previous: readonly PreviousIdentity[] | undefined,
  policy: CatalogIdentityPolicy,
  diagnostics: IntrospectionDiagnostic[],
): IdentityResolver {
  const byObject = new Map<object, CatalogResolvedIdentity>()
  const byGlobal = new Map<string, ResolvedReference | null>()
  const byScope = new Map<string, ResolvedReference | null>()
  const previousBySelector = new Map<string, PreviousIdentity | null>()

  for (const item of previous ?? []) {
    const key = identitySelectorKey(item.kind, item.physicalName, item.scopePhysicalName)
    const existing = previousBySelector.get(key)

    previousBySelector.set(key, existing === undefined ? item : null)
  }

  for (const entry of entries) {
    const identity = resolveIdentityEntry(entry, hints, previousBySelector, policy, diagnostics)

    byObject.set(entry.object, identity)
    registerIdentity(byGlobal, referenceKey(entry.kind, entry.currentId), {
      object: entry.object,
      identity,
    })
    if (entry.scopeId !== undefined) {
      registerIdentity(byScope, referenceKey(`${entry.kind}:${entry.scopeId}`, entry.currentId), {
        object: entry.object,
        identity,
      })
    }
  }

  return {
    forObject(object) {
      return byObject.get(object)
    },
    resolveReference(kind, id, scopeId) {
      const normalizedKind = normalizeIdentityKind(kind)

      if (scopeId !== undefined && normalizedKind !== undefined) {
        const scoped = byScope.get(referenceKey(`${normalizedKind}:${scopeId}`, id))

        if (scoped !== undefined && scoped !== null) {
          return scoped.identity
        }

        if (scoped === null) {
          return undefined
        }
      }

      const global = byGlobal.get(referenceKey(normalizedKind ?? kind, id))

      return global === undefined || global === null ? undefined : global.identity
    },
  }
}

function registerIdentity(
  map: Map<string, ResolvedReference | null>,
  key: string,
  value: ResolvedReference,
): void {
  const existing = map.get(key)

  // A duplicate selector is intentionally stored as null so ambiguous identities never silently
  // choose whichever object was registered last.
  map.set(key, existing === undefined ? value : null)
}

function resolveIdentityEntry(
  entry: IdentityEntry,
  hints: readonly CatalogIdentityHint[],
  previous: ReadonlyMap<string, PreviousIdentity | null>,
  policy: CatalogIdentityPolicy,
  diagnostics: IntrospectionDiagnostic[],
): CatalogResolvedIdentity {
  for (const source of policy.precedence) {
    if (source === "explicit-hint") {
      const matching = hints.filter(
        (hint) =>
          hint.kind === entry.kind &&
          hint.physicalName === entry.physicalName &&
          hint.tablePhysicalName === entry.scopePhysicalName,
      )
      const logicalIds = [...new Set(matching.map((hint) => hint.logicalId))]

      if (logicalIds.length > 1) {
        diagnostics.push(
          createIntrospectionDiagnostic({
            severity: "error",
            code: "ambiguous-identity",
            message: `Multiple identity hints match ${entry.kind} ${entry.physicalName}`,
            path: [entry.kind, entry.physicalName],
            remediation: "Provide one identity hint for each physical selector.",
          }),
        )
      } else if (logicalIds[0] !== undefined) {
        return {
          logicalId: logicalIds[0],
          source,
        }
      }
    } else if (source === "previous-snapshot") {
      const match = previous.get(
        identitySelectorKey(entry.kind, entry.physicalName, entry.scopePhysicalName),
      )

      if (match !== undefined && match !== null) {
        return {
          logicalId: match.id,
          source,
        }
      }

      if (match === null) {
        diagnostics.push(
          createIntrospectionDiagnostic({
            severity: "error",
            code: "ambiguous-identity",
            message: `Previous snapshot contains multiple ${entry.kind} objects named ${entry.physicalName}`,
            path: ["previousSnapshot", entry.kind, entry.physicalName],
            remediation: "Use an explicit identity hint for the ambiguous object.",
          }),
        )
      }
    } else if (source === "physical-name" && isSafeIdentityName(entry.physicalIdentityName)) {
      return {
        logicalId: entry.physicalIdentityName,
        source,
      }
    } else if (source === "deterministic-fallback") {
      return {
        logicalId: fallbackIdentity(entry, policy),
        source,
      }
    }
  }

  return {
    logicalId: fallbackIdentity(entry, policy),
    source: "deterministic-fallback",
  }
}

function identitySelectorKey(
  kind: CatalogIdentityEntityKind,
  physicalName: string,
  scopePhysicalName: string | undefined,
): string {
  return `${kind}\u0000${scopePhysicalName ?? ""}\u0000${physicalName}`
}

function normalizeIdentityKind(kind: string): CatalogIdentityEntityKind | undefined {
  if (kind === "primary-key" || kind === "unique" || kind === "foreign-key" || kind === "check") {
    return "constraint"
  }

  if (kind === "namespace" || kind === "deferred-object") {
    return undefined
  }

  return kind as CatalogIdentityEntityKind
}

function fallbackIdentity(entry: IdentityEntry, policy: CatalogIdentityPolicy): string {
  const seed = [
    entry.kind,
    entry.scopePhysicalName ?? "",
    entry.physicalName,
    entry.physicalIdentityName,
    entry.currentId,
  ].join(":")

  if (policy.fallback === "hashed") {
    return `introspected_${fnv1a32(seed)}`
  }

  const value = entry.physicalIdentityName || entry.currentId || entry.physicalName || seed

  return escapeIdentity(value)
}

function isSafeIdentityName(value: string): boolean {
  if (value.length === 0 || value !== value.trim()) {
    return false
  }

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0

    if (
      character === "." ||
      character === "\\" ||
      character === "/" ||
      character === '"' ||
      character === "'" ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    ) {
      return false
    }
  }

  return true
}

function escapeIdentity(value: string): string {
  let result = ""

  for (const character of value) {
    if (isSafeIdentityName(character)) {
      result += character
    } else {
      result += `_x${character.codePointAt(0)?.toString(16) ?? "0"}_`
    }
  }

  return result || "introspected_object"
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5

  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, "0")
}

function rewriteCatalog(
  input: IntrospectionCatalog,
  resolver: IdentityResolver,
  diagnostics: readonly IntrospectionDiagnostic[],
): IntrospectionCatalog {
  return {
    ...input,
    namespace: rewriteNamespace(input.namespace, resolver),
    tables: input.tables.map((table) => rewriteTable(table, resolver)),
    ...(input.views === undefined
      ? {}
      : { views: input.views.map((view) => rewriteView(view, resolver)) }),
    ...(input.sequences === undefined
      ? {}
      : { sequences: input.sequences.map((sequence) => rewriteSequence(sequence, resolver)) }),
    ...(input.enums === undefined
      ? {}
      : { enums: input.enums.map((item) => rewriteEnum(item, resolver)) }),
    ...(input.domains === undefined
      ? {}
      : { domains: input.domains.map((domain) => rewriteDomain(domain, resolver)) }),
    ...(input.collations === undefined
      ? {}
      : { collations: input.collations.map((item) => rewriteCollation(item, resolver)) }),
    ...(input.triggers === undefined
      ? {}
      : { triggers: input.triggers.map((item) => rewriteTrigger(item, resolver)) }),
    ...(input.routines === undefined
      ? {}
      : { routines: input.routines.map((item) => rewriteRoutine(item, resolver)) }),
    ...(input.partitions === undefined
      ? {}
      : { partitions: input.partitions.map((item) => rewritePartition(item, resolver)) }),
    ...(input.policies === undefined
      ? {}
      : { policies: input.policies.map((item) => rewritePolicy(item, resolver)) }),
    ...(input.extensionObjects === undefined
      ? {}
      : {
          extensionObjects: input.extensionObjects.map((item) => rewriteExtension(item, resolver)),
        }),
    deferredObjects: input.deferredObjects.map((item) => rewriteDeferred(item, resolver)),
    ...(input.opaqueObjects === undefined
      ? {}
      : { opaqueObjects: input.opaqueObjects.map((item) => rewriteOpaque(item, resolver)) }),
    ...(input.comments === undefined
      ? {}
      : { comments: input.comments.map((item) => rewriteComment(item, resolver)) }),
    ...(input.ownership === undefined
      ? {}
      : { ownership: input.ownership.map((item) => rewriteOwnership(item, resolver)) }),
    diagnostics: [...input.diagnostics, ...diagnostics],
  }
}

function rewriteNamespace(
  namespace: IntrospectionCatalog["namespace"],
  resolver: IdentityResolver,
): IntrospectionCatalog["namespace"] {
  return {
    ...rewriteMetadata(namespace, resolver),
  }
}

function rewriteTable(table: CatalogTable, resolver: IdentityResolver): CatalogTable {
  const owner: CatalogObjectOwner = { kind: "table", id: table.id }

  return {
    ...rewriteMetadata(table, resolver),
    ...rewriteIdentityFields(table, resolver),
    columns: table.columns.map((column) => ({
      ...rewriteMetadata(column, resolver, owner),
      ...rewriteIdentityFields(column, resolver),
    })),
    constraints: table.constraints.map((constraint) =>
      rewriteConstraint(constraint, resolver, owner),
    ),
    indexes: table.indexes.map((index) => rewriteIndex(index, resolver, owner)),
  }
}

function rewriteConstraint(
  constraint: CatalogConstraint,
  resolver: IdentityResolver,
  owner: CatalogObjectOwner,
): CatalogConstraint {
  const backingIndex =
    (constraint.kind === "primary-key" || constraint.kind === "unique") &&
    constraint.backingIndex !== undefined
      ? rewriteCatalogReference(constraint.backingIndex, resolver, owner)
      : undefined

  return {
    ...rewriteMetadata(constraint, resolver, owner),
    ...rewriteIdentityFields(constraint, resolver),
    ...(backingIndex === undefined ? {} : { backingIndex }),
  }
}

function rewriteIndex(
  index: CatalogIndex,
  resolver: IdentityResolver,
  owner: CatalogObjectOwner,
): CatalogIndex {
  return {
    ...rewriteMetadata(index, resolver, owner),
    ...rewriteIdentityFields(index, resolver),
    ...(index.backingConstraint === undefined
      ? {}
      : { backingConstraint: rewriteCatalogReference(index.backingConstraint, resolver, owner) }),
  }
}

function rewriteView(view: CatalogView, resolver: IdentityResolver): CatalogView {
  const owner: CatalogObjectOwner = { kind: view.kind, id: view.id }

  return {
    ...rewriteMetadata(view, resolver),
    ...rewriteIdentityFields(view, resolver),
    columns: view.columns.map((column) => ({
      ...rewriteMetadata(column, resolver, owner),
      ...rewriteIdentityFields(column, resolver),
    })),
    ...(view.dependencies === undefined
      ? {}
      : {
          dependencies: view.dependencies.map((reference) =>
            rewriteCatalogReference(reference, resolver),
          ),
        }),
  }
}

function rewriteSequence(
  sequence: import("./types.ts").CatalogSequence,
  resolver: IdentityResolver,
): import("./types.ts").CatalogSequence {
  return {
    ...rewriteMetadata(sequence, resolver),
    ...rewriteIdentityFields(sequence, resolver),
    ...(sequence.ownedBy === undefined
      ? {}
      : { ownedBy: rewriteCatalogReference(sequence.ownedBy, resolver) }),
  }
}

function rewriteEnum(item: CatalogEnum, resolver: IdentityResolver): CatalogEnum {
  return {
    ...rewriteMetadata(item, resolver),
    ...rewriteIdentityFields(item, resolver),
  }
}

function rewriteDomain(domain: CatalogDomain, resolver: IdentityResolver): CatalogDomain {
  const owner: CatalogObjectOwner = { kind: "domain", id: domain.id }

  return {
    ...rewriteMetadata(domain, resolver),
    ...rewriteIdentityFields(domain, resolver),
    ...(domain.constraints === undefined
      ? {}
      : {
          constraints: domain.constraints.map((constraint) => ({
            ...rewriteMetadata(constraint, resolver, owner),
            ...rewriteIdentityFields(constraint, resolver),
          })),
        }),
  }
}

function rewriteCollation(
  item: import("./types.ts").CatalogCollation,
  resolver: IdentityResolver,
): import("./types.ts").CatalogCollation {
  return {
    ...rewriteMetadata(item, resolver),
    ...rewriteIdentityFields(item, resolver),
  }
}

function rewriteTrigger(
  trigger: import("./types.ts").CatalogTrigger,
  resolver: IdentityResolver,
): import("./types.ts").CatalogTrigger {
  return {
    ...rewriteMetadata(trigger, resolver),
    ...rewriteIdentityFields(trigger, resolver),
    table: rewriteCatalogReference(trigger.table, resolver),
  }
}

function rewriteRoutine(
  routine: import("./types.ts").CatalogRoutine,
  resolver: IdentityResolver,
): import("./types.ts").CatalogRoutine {
  return {
    ...rewriteMetadata(routine, resolver),
    ...rewriteIdentityFields(routine, resolver),
    ...(routine.dependencies === undefined
      ? {}
      : {
          dependencies: routine.dependencies.map((reference) =>
            rewriteCatalogReference(reference, resolver),
          ),
        }),
  }
}

function rewritePartition(
  partition: import("./types.ts").CatalogPartition,
  resolver: IdentityResolver,
): import("./types.ts").CatalogPartition {
  return {
    ...rewriteMetadata(partition, resolver),
    ...rewriteIdentityFields(partition, resolver),
    parent: rewriteCatalogReference(partition.parent, resolver),
  }
}

function rewritePolicy(
  policy: import("./types.ts").CatalogPolicy,
  resolver: IdentityResolver,
): import("./types.ts").CatalogPolicy {
  return {
    ...rewriteMetadata(policy, resolver),
    ...rewriteIdentityFields(policy, resolver),
    table: rewriteCatalogReference(policy.table, resolver),
  }
}

function rewriteExtension(
  extension: CatalogExtensionObject,
  resolver: IdentityResolver,
): CatalogExtensionObject {
  return {
    ...rewriteMetadata(extension, resolver),
    ...rewriteIdentityFields(extension, resolver),
  }
}

function rewriteOpaque(
  object: CatalogOpaqueObject,
  resolver: IdentityResolver,
): CatalogOpaqueObject {
  return {
    ...rewriteMetadata(object, resolver),
    ...rewriteIdentityFields(object, resolver),
  }
}

function rewriteDeferred(
  object: import("./types.ts").CatalogDeferredObject,
  resolver: IdentityResolver,
): import("./types.ts").CatalogDeferredObject {
  return rewriteMetadata(object, resolver)
}

function rewriteMetadata<
  T extends {
    readonly comment?: import("./types.ts").CatalogComment
    readonly ownership?: import("./types.ts").CatalogOwnership
  },
>(object: T, resolver: IdentityResolver, fallbackOwner?: CatalogObjectOwner): T {
  return {
    ...object,
    ...(object.comment === undefined
      ? {}
      : { comment: rewriteComment(object.comment, resolver, fallbackOwner) }),
    ...(object.ownership === undefined
      ? {}
      : { ownership: rewriteOwnership(object.ownership, resolver, fallbackOwner) }),
  }
}

function rewriteIdentityFields(
  object: {
    readonly id: string
    readonly identitySource: CatalogIdentitySource
  },
  resolver: IdentityResolver,
): {
  readonly id: string
  readonly identitySource: CatalogIdentitySource
} {
  const identity = resolver.forObject(object)

  return identity === undefined
    ? {
        id: object.id,
        identitySource: object.identitySource,
      }
    : {
        id: identity.logicalId,
        identitySource: identity.source,
      }
}

function rewriteCatalogReference<T extends CatalogObjectReference | CatalogEntityReference>(
  reference: T,
  resolver: IdentityResolver,
  fallbackOwner?: CatalogObjectOwner,
): T {
  const tableId = isEntityReference(reference) ? reference.tableId : undefined
  const referenceOwner =
    reference.owner ??
    (tableId === undefined ? fallbackOwner : { kind: "table" as const, id: tableId })
  const identity = resolver.resolveReference(reference.kind, reference.id, referenceOwner?.id)
  const tableIdentity =
    referenceOwner?.kind === "table"
      ? resolver.resolveReference("table", referenceOwner.id)
      : undefined
  const rewrittenOwner =
    referenceOwner === undefined ? undefined : rewriteCatalogOwner(referenceOwner, resolver)

  return {
    ...reference,
    id: identity?.logicalId ?? reference.id,
    ...(reference.owner !== undefined || (fallbackOwner !== undefined && tableId === undefined)
      ? { owner: rewrittenOwner }
      : {}),
    ...(tableId === undefined ? {} : { tableId: tableIdentity?.logicalId ?? tableId }),
  } as T
}

function rewriteCatalogOwner(
  owner: CatalogObjectOwner,
  resolver: IdentityResolver,
): CatalogObjectOwner {
  const identity = resolver.resolveReference(owner.kind, owner.id)

  return {
    ...owner,
    id: identity?.logicalId ?? owner.id,
  }
}

function rewriteComment(
  comment: import("./types.ts").CatalogComment,
  resolver: IdentityResolver,
  fallbackOwner?: CatalogObjectOwner,
): import("./types.ts").CatalogComment {
  const identity = resolver.forObject(comment)

  return {
    ...comment,
    ...(identity === undefined ? {} : { id: identity.logicalId }),
    object: rewriteCatalogReference(comment.object, resolver, fallbackOwner),
  }
}

function rewriteOwnership(
  ownership: import("./types.ts").CatalogOwnership,
  resolver: IdentityResolver,
  fallbackOwner?: CatalogObjectOwner,
): import("./types.ts").CatalogOwnership {
  const identity = resolver.forObject(ownership)

  return {
    ...ownership,
    ...(identity === undefined ? {} : { id: identity.logicalId }),
    object: rewriteCatalogReference(ownership.object, resolver, fallbackOwner),
  }
}

function mapTable(
  table: CatalogTable,
  dialect: string,
  tables: ReadonlyMap<string, CatalogTable>,
  context: MappingContext,
): CompleteSnapshotTable {
  const owner: CompleteSnapshotObjectOwner = { kind: "table", id: table.id }
  const columns = table.columns.map((column) => mapColumn(column, dialect)).sort(compareId)
  // Constraint catalog references use physical names; index candidate-key checks use snapshot IDs.
  const columnIds = new Map(table.columns.map((column) => [column.physicalName, column.id]))
  const columnNullability = new Map(
    table.columns.map((column) => [column.physicalName, column.nullable]),
  )
  const snapshotColumnNullability = new Map(
    table.columns.map((column) => [column.id, column.nullable]),
  )
  const constraints = table.constraints
    .map((constraint) =>
      mapConstraint(constraint, dialect, columnIds, columnNullability, tables, context, [
        "tables",
        table.id,
        "constraints",
        constraint.id,
      ], owner),
    )
    .filter((value): value is CompleteSnapshotConstraint => value !== undefined)
    .sort(compareId)
  const indexes = table.indexes
    .map((index) =>
      mapIndex(index, dialect, columnIds, snapshotColumnNullability, context, [
        "tables",
        table.id,
        "indexes",
        index.id,
      ], owner),
    )
    .filter((index): index is CompleteSnapshotIndex => index !== undefined)
    .sort(compareId)

  return {
    kind: "table",
    id: table.id,
    physicalName: table.physicalName,
    columns,
    constraints,
    indexes,
    ...mapMetadata(table.provenance, table.dialect, dialect, table.reference),
  }
}

function mapColumn(column: CatalogColumn, dialect: string): CompleteSnapshotColumn {
  const defaultValue = column.default ? mapValueFact(column.default) : undefined
  const generatedColumn = column.generated
    ? column.generated.mode === "unknown"
      ? ({ kind: "external" } as const)
      : {
          kind: "expression" as const,
          expression: mapExpression(column.generated.expression),
          mode: column.generated.mode,
        }
    : undefined
  const identity = column.identity ? mapIdentity(column.identity, dialect) : undefined

  return {
    kind: "column",
    id: column.id,
    physicalName: column.physicalName,
    ordinalPosition: column.ordinalPosition,
    nullable: column.nullable,
    hasDefault: defaultValue !== undefined,
    generated: generatedColumn !== undefined || identity !== undefined,
    storage: mapStorage(column.storage, dialect),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(generatedColumn === undefined ? {} : { generatedColumn }),
    ...(identity === undefined ? {} : { identity }),
    ...(column.onUpdate === undefined ? {} : { onUpdate: mapExpression(column.onUpdate) }),
    ...mapMetadata(column.provenance, column.dialect, dialect, column.reference),
  }
}

function mapConstraint(
  constraint: CatalogConstraint,
  dialect: string,
  columns: ReadonlyMap<string, string>,
  columnNullability: ReadonlyMap<string, boolean>,
  tables: ReadonlyMap<string, CatalogTable>,
  context: MappingContext,
  path: readonly (string | number)[],
  owner: CompleteSnapshotObjectOwner,
): CompleteSnapshotConstraint | undefined {
  const physicalName = constraint.physicalName ?? constraint.id
  const common = {
    id: constraint.id,
    physicalName,
    ...mapMetadata(constraint.provenance, constraint.dialect, dialect, constraint.reference),
  }
  const mappedColumns =
    constraint.kind === "check"
      ? undefined
      : mapColumnNames(constraint.columns, columns, context, [...path, "columns"])

  if (mappedColumns === undefined && context.mode === "lossy") {
    return undefined
  }

  const backingIndex =
    constraint.kind === "primary-key" || constraint.kind === "unique"
      ? constraint.backingIndex === undefined
        ? undefined
        : mapReference(
            constraint.backingIndex,
            context,
            [...path, "backingIndex"],
            "index",
            owner,
          )
      : undefined

  if (constraint.kind === "check") {
    return {
      kind: "check",
      ...common,
      expression: mapExpression(constraint.expression),
      ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
      ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
      ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    }
  }

  if (constraint.kind === "primary-key") {
    return {
      kind: "primary-key",
      ...common,
      columns: mappedColumns ?? [],
      ...(backingIndex === undefined ? {} : { backingIndex }),
      ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
      ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
      ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    }
  }

  if (constraint.kind === "unique") {
    const isNullable = constraint.columns.some((column) => columnNullability.get(column) === true)

    if (!isNullable && constraint.nulls === "distinct") {
      return {
        kind: "unique",
        ...common,
        columns: mappedColumns ?? [],
        ...(backingIndex === undefined ? {} : { backingIndex }),
        ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
        ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
        ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
      }
    }

    return {
      kind: "unique-constraint",
      ...common,
      columns: mappedColumns ?? [],
      nulls: constraint.nulls,
      ...(backingIndex === undefined ? {} : { backingIndex }),
      ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
      ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
      ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    }
  }

  const targetTable = tables.get(constraint.target.table)
  const targetId = targetTable?.id

  if (targetId === undefined) {
    if (
      reportMappingIssue(context, {
        code: "unresolved-reference",
        message: `Foreign-key target table ${constraint.target.table} was not found`,
        path: [...path, "target", "table"],
      })
    ) {
      return undefined
    }
  }

  const targetColumnIds = targetTable
    ? new Map(targetTable.columns.map((column) => [column.physicalName, column.id]))
    : new Map<string, string>()
  const targetColumns = mapColumnNames(constraint.target.columns, targetColumnIds, context, [
    ...path,
    "target",
    "columns",
  ])

  if (targetColumns === undefined && context.mode === "lossy") {
    return undefined
  }

  return {
    kind: "foreign-key",
    ...common,
    columns: mappedColumns ?? [],
    target: {
      table: {
        kind: "table",
        id: targetId ?? constraint.target.table,
      },
      columns: targetColumns ?? [],
    },
    ...(constraint.onUpdate === undefined ? {} : { onUpdate: constraint.onUpdate }),
    ...(constraint.onDelete === undefined ? {} : { onDelete: constraint.onDelete }),
    ...(constraint.match === undefined ? {} : { match: constraint.match }),
    ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
    ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
    ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
  }
}

function mapColumnNames(
  names: readonly string[],
  columns: ReadonlyMap<string, string>,
  context: MappingContext,
  path: readonly (string | number)[],
): readonly string[] | undefined {
  let missing = false
  const result = names.map((name, index) => {
    const id = columns.get(name)

    if (id !== undefined) {
      return id
    }

    missing = true
    reportMappingIssue(context, {
      code: "unresolved-reference",
      message: `Column ${name} was not found`,
      path: [...path, index],
    })
    return name
  })

  return missing && context.mode === "lossy" ? undefined : result
}

function mapOptionalColumnNames(
  names: readonly string[] | undefined,
  columns: ReadonlyMap<string, string>,
  context: MappingContext,
  path: readonly (string | number)[],
): readonly string[] | undefined {
  if (names === undefined) {
    return undefined
  }

  return mapColumnNames(names, columns, context, path)
}

function mapIndex(
  index: CatalogIndex,
  dialect: string,
  columns: ReadonlyMap<string, string>,
  snapshotColumnNullability: ReadonlyMap<string, boolean>,
  context: MappingContext,
  path: readonly (string | number)[],
  owner: CompleteSnapshotObjectOwner,
): CompleteSnapshotIndex | undefined {
  const terms = index.terms.map((term, position) =>
    mapIndexTerm(term, columns, context, [...path, "terms", position]),
  )

  if (terms.some((term) => term === undefined) && context.mode === "lossy") {
    return undefined
  }

  const includedColumns = mapOptionalColumnNames(index.includedColumns, columns, context, [
    ...path,
    "includedColumns",
  ])
  const backingConstraint =
    index.backingConstraint === undefined
      ? undefined
      : mapReference(
          index.backingConstraint,
          context,
          [...path, "backingConstraint"],
          "constraint",
          owner,
        )

  const mapped: CompleteSnapshotIndex = {
    kind: "index",
    id: index.id,
    physicalName: index.physicalName ?? index.id,
    terms: terms
      .filter((term): term is CompleteSnapshotIndexTerm => term !== undefined)
      .sort((left, right) => left.position - right.position),
    unique: index.unique,
    candidateKey: false,
    ...(index.predicate === undefined ? {} : { predicate: mapExpression(index.predicate) }),
    ...(includedColumns === undefined ? {} : { includedColumns }),
    ...(backingConstraint === undefined ? {} : { backingConstraint }),
    ...(index.method === undefined ? {} : { method: index.method }),
    ...mapMetadata(undefined, index.dialect, dialect, index.reference),
  }

  return {
    ...mapped,
    candidateKey: hasCandidateKeyShape(mapped, snapshotColumnNullability),
  }
}

function mapIndexTerm(
  term: import("./types.ts").CatalogIndexTerm,
  columns: ReadonlyMap<string, string>,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotIndexTerm | undefined {
  if (term.kind === "column") {
    const column = columns.get(term.column)

    if (column === undefined) {
      if (
        reportMappingIssue(context, {
          code: "unresolved-reference",
          message: `Index column ${term.column} was not found`,
          path,
        })
      ) {
        return undefined
      }
    }

    return {
      kind: "column",
      column: column ?? term.column,
      position: term.position,
      ...(term.direction === undefined ? {} : { direction: term.direction }),
      ...(term.nulls === undefined ? {} : { nulls: term.nulls }),
      ...(term.prefixLength === undefined ? {} : { prefixLength: mapValueFact(term.prefixLength) }),
      ...(term.operatorClass === undefined ? {} : { operatorClass: term.operatorClass }),
    }
  }

  return {
    kind: "expression",
    expression: mapExpression(term.expression),
    position: term.position,
    ...(term.direction === undefined ? {} : { direction: term.direction }),
    ...(term.nulls === undefined ? {} : { nulls: term.nulls }),
    ...(term.operatorClass === undefined ? {} : { operatorClass: term.operatorClass }),
  }
}

function mapView(
  view: CatalogView,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotView {
  const dependencies = view.dependencies?.flatMap((reference, index) => {
    const mapped = mapReference(reference, context, [...path, "dependencies", index])

    return mapped === undefined ? [] : [mapped]
  })

  return {
    kind: view.kind,
    id: view.id,
    physicalName: view.physicalName,
    columns: view.columns.map((column) => mapColumn(column, dialect)).sort(compareId),
    definition: mapExpression(view.definition),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...(view.checkOption === undefined ? {} : { checkOption: view.checkOption }),
    ...(view.securityBarrier === undefined ? {} : { securityBarrier: view.securityBarrier }),
    ...(view.securityInvoker === undefined ? {} : { securityInvoker: view.securityInvoker }),
    ...mapMetadata(view.provenance, view.dialect, dialect, view.reference),
  }
}

function mapSequence(
  sequence: CatalogSequence,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotSequence {
  const ownedBy =
    sequence.ownedBy === undefined
      ? undefined
      : mapReference(sequence.ownedBy, context, [...path, "ownedBy"])

  return {
    kind: "sequence",
    id: sequence.id,
    physicalName: sequence.physicalName,
    ...(sequence.storage === undefined ? {} : { storage: mapStorage(sequence.storage, dialect) }),
    ...(sequence.start === undefined ? {} : { start: mapValueFact(sequence.start) }),
    ...(sequence.increment === undefined ? {} : { increment: mapValueFact(sequence.increment) }),
    ...(sequence.minimum === undefined ? {} : { minimum: mapValueFact(sequence.minimum) }),
    ...(sequence.maximum === undefined ? {} : { maximum: mapValueFact(sequence.maximum) }),
    ...(sequence.cache === undefined ? {} : { cache: mapValueFact(sequence.cache) }),
    ...(sequence.cycle === undefined ? {} : { cycle: sequence.cycle }),
    ...(ownedBy === undefined ? {} : { ownedBy }),
    ...(sequence.identity === undefined
      ? {}
      : { identity: mapIdentity(sequence.identity, dialect) }),
    ...mapMetadata(sequence.provenance, sequence.dialect, dialect, sequence.reference),
  }
}

function mapEnum(item: CatalogEnum, dialect: string): CompleteSnapshotEnum {
  return {
    kind: "enum",
    id: item.id,
    physicalName: item.physicalName,
    values: [...item.values]
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((value) => ({
        value: value.value,
        ordinalPosition: value.ordinalPosition,
        ...(value.provenance === undefined ? {} : { provenance: mapProvenance(value.provenance) }),
      })),
    ...mapMetadata(item.provenance, item.dialect, dialect, item.reference),
  }
}

function mapDomain(domain: CatalogDomain, dialect: string): CompleteSnapshotDomain {
  return {
    kind: "domain",
    id: domain.id,
    physicalName: domain.physicalName,
    storage: mapStorage(domain.storage, dialect),
    ...(domain.nullable === undefined ? {} : { nullable: domain.nullable }),
    ...(domain.default === undefined ? {} : { default: mapValueFact(domain.default) }),
    ...(domain.constraints === undefined
      ? {}
      : {
          constraints: domain.constraints
            .map((constraint) => mapCheckConstraint(constraint, dialect))
            .sort(compareId),
        }),
    ...mapMetadata(domain.provenance, domain.dialect, dialect, domain.reference),
  }
}

function mapCheckConstraint(
  constraint: import("./types.ts").CatalogCheckConstraint,
  dialect: string,
): CompleteSnapshotCheckConstraint {
  return {
    kind: "check",
    id: constraint.id,
    physicalName: constraint.physicalName ?? constraint.id,
    expression: mapExpression(constraint.expression),
    ...(constraint.deferrable === undefined ? {} : { deferrable: constraint.deferrable }),
    ...(constraint.initially === undefined ? {} : { initially: constraint.initially }),
    ...(constraint.validated === undefined ? {} : { validated: constraint.validated }),
    ...mapMetadata(constraint.provenance, constraint.dialect, dialect, constraint.reference),
  }
}

function mapTrigger(
  trigger: CatalogTrigger,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotTrigger | undefined {
  const table = mapReference(trigger.table, context, [...path, "table"], "table")

  if (table === undefined && context.mode === "lossy") {
    return undefined
  }

  return {
    kind: "trigger",
    id: trigger.id,
    physicalName: trigger.physicalName,
    table: table ?? {
      kind: "table",
      id: trigger.table.id,
    },
    timing: trigger.timing,
    events: [...trigger.events].sort(),
    ...(trigger.orientation === undefined ? {} : { orientation: trigger.orientation }),
    ...(trigger.condition === undefined ? {} : { condition: mapExpression(trigger.condition) }),
    body: mapExpression(trigger.body),
    ...(trigger.enabled === undefined ? {} : { enabled: trigger.enabled }),
    ...mapMetadata(trigger.provenance, trigger.dialect, dialect, trigger.reference),
  }
}

function mapRoutine(
  routine: CatalogRoutine,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotRoutine {
  const dependencies = routine.dependencies?.flatMap((reference, index) => {
    const mapped = mapReference(reference, context, [...path, "dependencies", index])

    return mapped === undefined ? [] : [mapped]
  })

  return {
    kind: "routine",
    id: routine.id,
    physicalName: routine.physicalName,
    routineKind: routine.routineKind,
    parameters: [...routine.parameters]
      .sort((left, right) => left.ordinalPosition - right.ordinalPosition)
      .map((parameter) => mapRoutineParameter(parameter, dialect)),
    ...(routine.returnType === undefined
      ? {}
      : { returnType: mapStorage(routine.returnType, dialect) }),
    ...(routine.language === undefined ? {} : { language: routine.language }),
    ...(routine.body === undefined ? {} : { body: mapExpression(routine.body) }),
    ...(routine.volatility === undefined ? {} : { volatility: routine.volatility }),
    ...(routine.parallel === undefined ? {} : { parallel: routine.parallel }),
    ...(routine.security === undefined ? {} : { security: routine.security }),
    ...(dependencies === undefined ? {} : { dependencies }),
    ...mapMetadata(routine.provenance, routine.dialect, dialect, routine.reference),
  }
}

function mapRoutineParameter(
  parameter: import("./types.ts").CatalogRoutineParameter,
  dialect: string,
): CompleteSnapshotRoutineParameter {
  return {
    ...(parameter.name === undefined ? {} : { name: parameter.name }),
    ...(parameter.mode === undefined ? {} : { mode: parameter.mode }),
    storage: mapStorage(parameter.storage, dialect),
    ...(parameter.default === undefined ? {} : { default: mapValueFact(parameter.default) }),
    ordinalPosition: parameter.ordinalPosition,
    ...(parameter.provenance === undefined
      ? {}
      : { provenance: mapProvenance(parameter.provenance) }),
  }
}

function mapPartition(
  partition: CatalogPartition,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotPartition | undefined {
  const parent = mapReference(partition.parent, context, [...path, "parent"], "table")

  if (parent === undefined && context.mode === "lossy") {
    return undefined
  }

  return {
    kind: "partition",
    id: partition.id,
    physicalName: partition.physicalName,
    parent: parent ?? {
      kind: "table",
      id: partition.parent.id,
    },
    strategy: partition.strategy,
    ...(partition.keyColumns === undefined ? {} : { keyColumns: [...partition.keyColumns] }),
    ...(partition.bound === undefined ? {} : { bound: mapExpression(partition.bound) }),
    ...(partition.default === undefined ? {} : { default: partition.default }),
    ...mapMetadata(partition.provenance, partition.dialect, dialect, partition.reference),
  }
}

function mapPolicy(
  policy: CatalogPolicy,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
): CompleteSnapshotPolicy | undefined {
  const table = mapReference(policy.table, context, [...path, "table"], "table")

  if (table === undefined && context.mode === "lossy") {
    return undefined
  }

  return {
    kind: "policy",
    id: policy.id,
    physicalName: policy.physicalName,
    table: table ?? {
      kind: "table",
      id: policy.table.id,
    },
    command: policy.command,
    ...(policy.roles === undefined ? {} : { roles: [...policy.roles].sort() }),
    ...(policy.permissive === undefined ? {} : { permissive: policy.permissive }),
    ...(policy.using === undefined ? {} : { using: mapExpression(policy.using) }),
    ...(policy.check === undefined ? {} : { check: mapExpression(policy.check) }),
    ...mapMetadata(policy.provenance, policy.dialect, dialect, policy.reference),
  }
}

function mapExtensionObject(
  extension: CatalogExtensionObject,
  dialect: string,
): CompleteSnapshotExtension {
  return {
    kind: "extension",
    id: extension.id,
    physicalName: extension.physicalName,
    extensionName: extension.extensionName,
    ...(extension.extensionVersion === undefined
      ? {}
      : { extensionVersion: extension.extensionVersion }),
    ...(extension.schema === undefined ? {} : { schema: extension.schema }),
    data: toSnapshotJsonValue(extension.data),
    ...(extension.configuration === undefined
      ? {}
      : { configuration: toSnapshotJsonValue(extension.configuration) }),
    ...mapMetadata(extension.provenance, extension.dialect, dialect, extension.reference),
  }
}

function mapDeferredObject(
  object: import("./types.ts").CatalogDeferredObject,
  dialect: string,
): CompleteSnapshotDeferredObject {
  const data = object.unknownFields
    ? Object.fromEntries(
        object.unknownFields.map((field) => [
          field.name,
          toSnapshotJsonValue(isCatalogSqlExpression(field.value) ? field.value.text : field.value),
        ]),
      )
    : undefined

  return {
    kind: "deferred-object",
    id: object.id ?? `deferred:${object.objectKind}:${object.physicalName}`,
    objectKind: object.objectKind,
    physicalName: object.physicalName,
    ...(data === undefined ? {} : { data: toSnapshotJsonValue(data) }),
    ...mapMetadata(object.provenance, object.dialect, dialect, object.reference),
  }
}

function mapOpaqueObject(
  object: CatalogOpaqueObject,
  dialect: string,
): CompleteSnapshotOpaqueObject {
  return {
    kind: "opaque-object",
    id: object.id,
    objectKind: object.objectKind,
    physicalName: object.physicalName,
    data: toSnapshotJsonValue(object.data),
    ...(object.sql === undefined ? {} : { sql: mapExpression(object.sql) }),
    ...mapMetadata(object.provenance, object.dialect, dialect, object.reference),
  }
}

function mapComment(
  comment: import("./types.ts").CatalogComment,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
  fallbackOwner?: CompleteSnapshotObjectOwner,
): CompleteSnapshotComment | undefined {
  const object = mapReference(comment.object, context, [...path, "object"], undefined, fallbackOwner)

  if (object === undefined && context.mode === "lossy") {
    return undefined
  }

  return {
    kind: "comment",
    id: comment.id,
    physicalName: comment.reference?.name ?? comment.id,
    object: object ?? comment.object,
    text: comment.text,
    ...mapMetadata(comment.provenance, comment.dialect, dialect, comment.reference),
  }
}

function mapOwnership(
  ownership: import("./types.ts").CatalogOwnership,
  dialect: string,
  context: MappingContext,
  path: readonly (string | number)[],
  fallbackOwner?: CompleteSnapshotObjectOwner,
): CompleteSnapshotOwnership | undefined {
  const object = mapReference(
    ownership.object,
    context,
    [...path, "object"],
    undefined,
    fallbackOwner,
  )

  if (object === undefined && context.mode === "lossy") {
    return undefined
  }

  return {
    kind: "ownership",
    id: ownership.id,
    physicalName: ownership.reference?.name ?? ownership.id,
    object: object ?? ownership.object,
    owner: ownership.owner,
    ...mapMetadata(ownership.provenance, ownership.dialect, dialect, ownership.reference),
  }
}

function mapStorage(
  storage: import("./types.ts").CatalogStorageType,
  dialect: string,
): import("../snapshot/types.ts").SnapshotStorage {
  return {
    kind: "native",
    dialect,
    type: storage.nativeType,
    ...(dialect === "sqlite" ? { affinity: storageAffinity(storage.nativeType) } : {}),
  }
}

function mapValueFact(value: CatalogValueFact): CompleteSnapshotValueFact {
  if (value.kind === "literal") {
    return {
      kind: "literal",
      value: mapLiteral(value),
    }
  }

  return {
    kind: "expression",
    expression: mapExpression(value.expression),
  }
}

function mapLiteral(value: CatalogLiteralFact): import("../snapshot/types.ts").SnapshotLiteral {
  if (value.value === null) {
    return { kind: "null" }
  }

  if (typeof value.value === "boolean") {
    return {
      kind: "boolean",
      value: value.value,
    }
  }

  if (typeof value.value === "bigint") {
    return {
      kind: "bigint",
      value: value.value.toString(),
    }
  }

  if (typeof value.value === "number") {
    return {
      kind: "number",
      value: String(value.value),
    }
  }

  return {
    kind: "string",
    value: value.value,
  }
}

function mapIdentity(
  identity: import("./types.ts").CatalogIdentity,
  dialect: string,
): CompleteSnapshotIdentity {
  return {
    kind: "identity",
    generation: identity.generation,
    options: Object.fromEntries(
      Object.entries(identity.options).map(([key, value]) => [key, mapValueFact(value)]),
    ),
    ...mapMetadata(undefined, identity.dialect, dialect),
  }
}

function mapExpression(value: CatalogSqlExpression) {
  return {
    kind: "expression" as const,
    expressionKind: "unsafe",
    sql: value.text.replace(/\r\n?/g, "\n").trim(),
    dialect: value.dialect,
  }
}

function mapMetadata(
  provenance: CatalogProvenance | undefined,
  extension: CatalogDialectExtension | undefined,
  dialect: string,
  reference?: CatalogReference,
): CompleteSnapshotObjectMetadata {
  const mappedProvenance = provenance ? mapProvenance(provenance) : undefined
  const mappedExtension = extension
    ? {
        dialect: extension.dialect,
        version: extension.version,
        data: toSnapshotJsonValue(extension.data),
      }
    : undefined
  const physicalReference = reference
    ? {
        kind: reference.kind as import("../snapshot/complete-types.ts").CompleteSnapshotObjectKind,
        ...(reference.namespace === undefined ? {} : { namespace: reference.namespace }),
        ...(reference.table === undefined ? {} : { table: reference.table }),
        name: reference.name,
      }
    : undefined

  // Catalog objects may carry no provenance but their opaque extension must
  // still remain explicitly tagged. Do not synthesize a dialect extension.
  void dialect
  return {
    ...(mappedProvenance === undefined ? {} : { provenance: mappedProvenance }),
    ...(physicalReference === undefined ? {} : { physicalReference }),
    ...(mappedExtension === undefined ? {} : { dialect: mappedExtension }),
  }
}

function mapProvenance(value: CatalogProvenance) {
  return {
    kind: value.kind,
    dialect: value.dialect,
    ...(value.path === undefined ? {} : { path: [...value.path] }),
  }
}

function mapReference(
  reference: CatalogObjectReference | CatalogEntityReference,
  context: MappingContext,
  path: readonly (string | number)[],
  expectedKind?: CompleteSnapshotObjectReference["kind"],
  fallbackOwner?: CompleteSnapshotObjectOwner,
): CompleteSnapshotObjectReference | undefined {
  // Nested refs may use legacy tableId or omit owner metadata; infer a unique scope before the
  // complete-snapshot validator requires one.
  const kind = normalizeReferenceKind(reference.kind)
  const tableId = isEntityReference(reference) ? reference.tableId : undefined
  const explicitOwner =
    reference.owner ??
    (tableId === undefined ? fallbackOwner : { kind: "table" as const, id: tableId })
  const lookupReference = {
    ...reference,
    kind: kind as CatalogObjectReference["kind"],
    ...(explicitOwner === undefined ? {} : { owner: explicitOwner }),
  } as CatalogObjectReference | CatalogEntityReference
  const owner = explicitOwner ?? context.references.owner(lookupReference)
  const scopedLookupReference = {
    ...lookupReference,
    ...(owner === undefined ? {} : { owner }),
  } as CatalogObjectReference | CatalogEntityReference
  const validKind = expectedKind === undefined || kind === expectedKind
  const ownerRequired = kind === "column" || kind === "constraint" || kind === "index"
  const validReference = context.references.has(scopedLookupReference)

  if (!validKind || !validReference || (ownerRequired && owner === undefined)) {
    if (
      reportMappingIssue(context, {
        code: "unresolved-reference",
        message: !validKind
          ? `Reference kind ${reference.kind} is not valid here`
          : ownerRequired && owner === undefined
            ? `Reference ${reference.kind}:${reference.id} has no unique owner scope`
            : `Reference ${reference.kind}:${reference.id} was not found`,
        path,
      })
    ) {
      return undefined
    }
  }

  return {
    kind: kind as CompleteSnapshotObjectReference["kind"],
    id: reference.id,
    ...(owner === undefined ? {} : { owner }),
  }
}

function normalizeReferenceKind(kind: string): string {
  return kind === "primary-key" || kind === "unique" || kind === "foreign-key" || kind === "check"
    ? "constraint"
    : kind
}

function catalogObjectList(catalog: CompleteIntrospectionCatalog): readonly {
  readonly kind: string
  readonly id?: string
  readonly physicalName?: string
  readonly comment?: import("./types.ts").CatalogComment
  readonly ownership?: import("./types.ts").CatalogOwnership
  readonly unknownFields?: readonly CatalogUnknownField[]
  readonly ownerScope?: CatalogObjectOwner
}[] {
  const topLevel = [
    catalog.namespace,
    ...catalog.tables,
    ...catalog.views,
    ...catalog.sequences,
    ...catalog.enums,
    ...catalog.domains,
    ...catalog.collations,
    ...catalog.triggers,
    ...catalog.routines,
    ...catalog.partitions,
    ...catalog.policies,
    ...catalog.extensionObjects,
    ...catalog.deferredObjects,
    ...catalog.opaqueObjects,
    ...catalog.comments,
    ...catalog.ownership,
  ]
  const nested = [
    ...catalog.tables.flatMap((table) => {
      const owner: CatalogObjectOwner = { kind: "table", id: table.id }

      return [
        ...table.columns.map((object) => ({ ...object, ownerScope: owner })),
        ...table.constraints.map((object) => ({ ...object, ownerScope: owner })),
        ...table.indexes.map((object) => ({ ...object, ownerScope: owner })),
      ]
    }),
    ...catalog.views.flatMap((view) => {
      const owner: CatalogObjectOwner = { kind: view.kind, id: view.id }

      return view.columns.map((object) => ({ ...object, ownerScope: owner }))
    }),
    ...catalog.domains.flatMap((domain) => {
      const owner: CatalogObjectOwner = { kind: "domain", id: domain.id }

      return (domain.constraints ?? []).map((object) => ({ ...object, ownerScope: owner }))
    }),
  ]

  return [...topLevel, ...nested]
}

function catalogObjectsWithUnknownFields(catalog: CompleteIntrospectionCatalog): readonly {
  readonly kind: string
  readonly id?: string
  readonly physicalName?: string
  readonly unknownFields?: readonly CatalogUnknownField[]
  readonly ownerScope?: CatalogObjectOwner
}[] {
  return catalogObjectList(catalog)
}

function mapUnknownField(
  object: {
    readonly kind: string
    readonly id?: string
    readonly physicalName?: string
  },
  field: CatalogUnknownField,
  dialect: string,
): CompleteSnapshotOpaqueObject {
  const sql = isCatalogSqlExpression(field.value) ? mapExpression(field.value) : undefined
  const value = isCatalogSqlExpression(field.value) ? field.value.text : field.value

  return {
    kind: "opaque-object",
    id: `unknown:${object.kind}:${object.id ?? object.physicalName ?? "object"}:${field.name}`,
    objectKind: "unknown-field",
    physicalName: object.physicalName ?? object.id ?? field.name,
    data: toSnapshotJsonValue({
      ownerKind: object.kind,
      ownerId: object.id ?? object.physicalName ?? field.name,
      field: field.name,
      value,
    }),
    ...(sql === undefined ? {} : { sql }),
    ...mapMetadata(field.provenance, undefined, dialect),
  }
}

function compareId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function isCatalogSqlExpression(value: unknown): value is CatalogSqlExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { readonly kind?: unknown }).kind === "sql" &&
    typeof (value as { readonly text?: unknown }).text === "string"
  )
}
