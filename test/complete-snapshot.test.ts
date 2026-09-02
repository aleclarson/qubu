import { expect, test } from "vitest"

import {
  createCompleteIntrospectionCatalog,
  mapCatalogToCompleteSnapshot,
  type CatalogColumn,
  type IntrospectionCatalog,
} from "../src/introspection/index.ts"
import {
  assertCompleteSchemaSnapshot,
  completeSchemaSnapshotFingerprint,
  decodeCompleteSchemaSnapshot,
  encodeCompleteSchemaSnapshot,
  type CompleteSchemaSnapshot,
} from "../src/snapshot/index.ts"

const capabilities = {
  generatedColumns: true,
  identityMetadata: true,
  checkConstraints: true,
  checkConstraintEnforcement: "enforced" as const,
  expressionDecompilation: true,
  indexExpressions: true,
  indexPredicates: true,
  indexIncludedColumns: true,
  namespaces: true,
  visibility: "complete" as const,
}

const expression = {
  kind: "expression" as const,
  expressionKind: "unsafe",
  sql: "CURRENT_TIMESTAMP",
  dialect: "postgresql",
}

function completeSnapshot(): CompleteSchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect: {
      name: "postgresql",
      version: 1,
    },
    namingPolicy: {
      name: "introspected-physical",
      version: 1,
    },
    namespace: {
      kind: "postgres-schema",
      name: "public",
    },
    capabilities,
    tables: [
      {
        kind: "table",
        id: "accounts",
        physicalName: "accounts",
        physicalReference: {
          kind: "table",
          namespace: "public",
          name: "accounts",
        },
        columns: [
          {
            kind: "column",
            id: "id",
            physicalName: "id",
            ordinalPosition: 1,
            nullable: false,
            hasDefault: false,
            generated: false,
            storage: {
              kind: "native",
              dialect: "postgresql",
              type: "integer",
            },
          },
        ],
        constraints: [
          {
            kind: "primary-key",
            id: "accounts_pkey",
            physicalName: "accounts_pkey",
            columns: ["id"],
          },
        ],
        indexes: [],
      },
    ],
    views: [
      {
        kind: "view",
        id: "account_view",
        physicalName: "account_view",
        columns: [],
        definition: expression,
      },
    ],
    sequences: [],
    enums: [],
    domains: [],
    collations: [],
    triggers: [],
    routines: [],
    partitions: [],
    policies: [],
    extensions: [],
    deferredObjects: [],
    opaqueObjects: [],
    comments: [
      {
        kind: "comment",
        id: "accounts-comment",
        physicalName: "accounts-comment",
        object: {
          kind: "table",
          id: "accounts",
        },
        text: "Accounts",
      },
    ],
    ownership: [],
  }
}

test("encodes and decodes complete immutable object families", () => {
  const snapshot = assertCompleteSchemaSnapshot(completeSnapshot())
  const encoded = encodeCompleteSchemaSnapshot(snapshot)
  const decoded = decodeCompleteSchemaSnapshot(encoded)

  expect(decoded.ok).toBe(true)
  expect(snapshot.version).toBe(1)
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(snapshot.tables[0])).toBe(true)
  expect(completeSchemaSnapshotFingerprint(encoded)).toBe(
    completeSchemaSnapshotFingerprint(snapshot),
  )
  if (decoded.ok) {
    expect(encodeCompleteSchemaSnapshot(decoded.value)).toBe(encoded)
  }
})

test("checks dialect provenance and native metadata throughout typed nested fields", () => {
  const malformed = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as {
    tables: Array<{
      columns: Array<Record<string, unknown>>
      constraints: Array<Record<string, unknown>>
      indexes: Array<Record<string, unknown>>
    }>
    domains: Array<Record<string, unknown>>
    enums: Array<Record<string, unknown>>
  }
  const column = malformed.tables[0]!.columns[0]!

  column.provenance = { kind: "catalog", dialect: "mysql" }
  column.dialect = { dialect: "mysql", version: 1, data: {} }
  column.storage = { kind: "native", dialect: "mysql", type: "integer" }
  column.identity = {
    kind: "identity",
    generation: "always",
    options: {},
    provenance: { kind: "catalog", dialect: "mysql" },
  }
  column.onUpdate = {
    kind: "expression",
    expressionKind: "unsafe",
    sql: "CURRENT_TIMESTAMP",
    dialect: "mysql",
  }
  malformed.tables[0]!.constraints[0]!.provenance = {
    kind: "catalog",
    dialect: "mysql",
  }
  malformed.tables[0]!.indexes.push({
    kind: "index",
    id: "accounts_index",
    physicalName: "accounts_index",
    terms: [
      {
        kind: "expression",
        expression: {
          kind: "expression",
          expressionKind: "unsafe",
          sql: "lower(id)",
          dialect: "mysql",
        },
        position: 1,
      },
    ],
    unique: false,
    candidateKey: false,
  })
  malformed.domains.push({
    kind: "domain",
    id: "account_id",
    physicalName: "account_id",
    storage: { kind: "native", dialect: "mysql", type: "integer" },
    constraints: [
      {
        kind: "check",
        id: "account_id_positive",
        physicalName: "account_id_positive",
        expression: {
          kind: "expression",
          expressionKind: "unsafe",
          sql: "VALUE > 0",
          dialect: "mysql",
        },
        provenance: { kind: "catalog", dialect: "mysql" },
      },
    ],
  })
  malformed.enums.push({
    kind: "enum",
    id: "account_status",
    physicalName: "account_status",
    values: [
      {
        value: "active",
        ordinalPosition: 1,
        provenance: { kind: "catalog", dialect: "mysql" },
      },
    ],
  })

  const result = decodeCompleteSchemaSnapshot(malformed)

  expect(result.ok).toBe(false)
  if (!result.ok) {
    const mismatchPaths = result.diagnostics
      .filter((diagnostic) => diagnostic.code === "dialect-mismatch")
      .map((diagnostic) => JSON.stringify(diagnostic.path))

    expect(mismatchPaths).toEqual(
      expect.arrayContaining([
        '["tables",0,"columns",0,"provenance","dialect"]',
        '["tables",0,"columns",0,"dialect","dialect"]',
        '["tables",0,"columns",0,"storage","dialect"]',
        '["tables",0,"columns",0,"identity","provenance","dialect"]',
        '["tables",0,"columns",0,"onUpdate","dialect"]',
        '["tables",0,"constraints",0,"provenance","dialect"]',
        '["tables",0,"indexes",0,"terms",0,"expression","dialect"]',
        '["domains",0,"storage","dialect"]',
        '["domains",0,"constraints",0,"expression","dialect"]',
        '["domains",0,"constraints",0,"provenance","dialect"]',
        '["enums",0,"values",0,"provenance","dialect"]',
      ]),
    )
  }
})

test("resolves nested references by owner scope and rejects incorrect local scope", () => {
  const candidate = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as {
    tables: Array<{
      id: string
      physicalName: string
      columns: Array<Record<string, unknown>>
      constraints: Array<Record<string, unknown>>
      indexes: Array<Record<string, unknown>>
      [key: string]: unknown
    }>
    comments: Array<Record<string, unknown>>
  }
  const accounts = candidate.tables[0]!
  const sharedIndex = {
    kind: "index",
    id: "shared_index",
    physicalName: "shared_index",
    terms: [{ kind: "column", column: "id", position: 1 }],
    unique: false,
    candidateKey: false,
  }

  accounts.indexes = [sharedIndex]
  accounts.constraints[0]!.backingIndex = {
    kind: "index",
    id: "shared_index",
    owner: { kind: "table", id: "accounts" },
  }
  candidate.tables.push({
    ...accounts,
    id: "users",
    physicalName: "users",
    constraints: [],
    indexes: [{ ...sharedIndex }],
  })
  candidate.comments.push({
    kind: "comment",
    id: "column_comment",
    physicalName: "column_comment",
    object: {
      kind: "column",
      id: "id",
      owner: { kind: "table", id: "accounts" },
    },
    text: "Account identifier",
  })

  const valid = decodeCompleteSchemaSnapshot(candidate)

  expect(valid.ok).toBe(true)
  if (!valid.ok) {
    return
  }

  const wrongScope = JSON.parse(encodeCompleteSchemaSnapshot(valid.value)) as {
    tables: Array<{ constraints: Array<Record<string, unknown>> }>
  }
  const backingIndex = wrongScope.tables[0]!.constraints[0]!.backingIndex as Record<string, unknown>
  ;(backingIndex.owner as Record<string, unknown>).id = "users"

  const wrongScopeResult = decodeCompleteSchemaSnapshot(wrongScope)

  expect(wrongScopeResult.ok).toBe(false)
  if (!wrongScopeResult.ok) {
    expect(
      wrongScopeResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid-cross-reference" && diagnostic.path.includes("owner"),
      ),
    ).toBe(true)
  }

  const missingScope = JSON.parse(encodeCompleteSchemaSnapshot(valid.value)) as {
    tables: Array<{ constraints: Array<Record<string, unknown>> }>
  }
  const missingOwnerReference = missingScope.tables[0]!.constraints[0]!.backingIndex as Record<
    string,
    unknown
  >
  delete missingOwnerReference.owner

  const missingScopeResult = decodeCompleteSchemaSnapshot(missingScope)

  expect(missingScopeResult.ok).toBe(false)
  if (!missingScopeResult.ok) {
    expect(
      missingScopeResult.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid-cross-reference" &&
          diagnostic.message.includes("owner scope"),
      ),
    ).toBe(true)
  }

  const duplicate = JSON.parse(encodeCompleteSchemaSnapshot(valid.value)) as {
    tables: Array<{ indexes: Array<Record<string, unknown>> }>
  }
  duplicate.tables[0]!.indexes.push({ ...duplicate.tables[0]!.indexes[0]! })

  const duplicateResult = decodeCompleteSchemaSnapshot(duplicate)

  expect(duplicateResult.ok).toBe(false)
  if (!duplicateResult.ok) {
    expect(
      duplicateResult.diagnostics.some(
        (diagnostic) => diagnostic.code === "invalid-cross-reference",
      ),
    ).toBe(true)
  }
})

test("sorts and scopes domain constraints while retaining their metadata", () => {
  const candidate = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as {
    domains: Array<Record<string, unknown>>
    comments: Array<Record<string, unknown>>
  }
  const constraints = [
    {
      kind: "check",
      id: "domain_check_a",
      physicalName: "domain_check_a",
      expression: { kind: "expression", expressionKind: "portable", sql: "VALUE IS NOT NULL" },
      provenance: { kind: "catalog", dialect: "postgresql" },
    },
    {
      kind: "check",
      id: "domain_check_b",
      physicalName: "domain_check_b",
      expression: { kind: "expression", expressionKind: "portable", sql: "VALUE > 0" },
    },
  ]

  candidate.domains.push({
    kind: "domain",
    id: "account_id",
    physicalName: "account_id",
    storage: { kind: "native", dialect: "postgresql", type: "integer" },
    constraints,
  })
  candidate.comments.push({
    kind: "comment",
    id: "domain_constraint_comment",
    physicalName: "domain_constraint_comment",
    object: {
      kind: "constraint",
      id: "domain_check_a",
      owner: { kind: "domain", id: "account_id" },
    },
    text: "Domain check",
  })

  const valid = decodeCompleteSchemaSnapshot(candidate)

  expect(valid.ok).toBe(true)
  if (!valid.ok) {
    return
  }

  expect(valid.value.domains[0]?.constraints?.[0]?.provenance).toEqual({
    kind: "catalog",
    dialect: "postgresql",
  })

  const reversed = JSON.parse(encodeCompleteSchemaSnapshot(valid.value)) as {
    domains: Array<{ constraints?: Array<Record<string, unknown>> }>
  }
  reversed.domains[0]!.constraints!.reverse()

  const reversedResult = decodeCompleteSchemaSnapshot(reversed)

  expect(reversedResult.ok).toBe(false)
  if (!reversedResult.ok) {
    expect(
      reversedResult.diagnostics.some((diagnostic) => diagnostic.code === "non-canonical"),
    ).toBe(true)
  }
})

test("accepts negative fractional literals but rejects negative zero and leading-zero forms", () => {
  const withDefault = (): {
    tables: Array<{ columns: Array<Record<string, unknown>> }>
  } => JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot()))

  const accepted = withDefault()
  accepted.tables[0]!.columns[0]!.hasDefault = true
  accepted.tables[0]!.columns[0]!.default = {
    kind: "literal",
    value: { kind: "number", value: "-0.5" },
  }

  expect(decodeCompleteSchemaSnapshot(accepted).ok).toBe(true)

  for (const value of ["-0", "01", "1e01"]) {
    const malformed = withDefault()
    malformed.tables[0]!.columns[0]!.hasDefault = true
    malformed.tables[0]!.columns[0]!.default = {
      kind: "literal",
      value: { kind: "number", value },
    }

    expect(decodeCompleteSchemaSnapshot(malformed).ok).toBe(false)
  }
})

test("preserves own __proto__ payload keys and ignores opaque dialect-shaped JSON", () => {
  const data = JSON.parse('{"__proto__":{"kind":"expression","dialect":"mysql"}}') as Record<
    string,
    unknown
  >
  const candidate = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as {
    extensions: Array<Record<string, unknown>>
  }

  candidate.extensions.push({
    kind: "extension",
    id: "payload_extension",
    physicalName: "payload_extension",
    extensionName: "payload_extension",
    data,
    configuration: { kind: "expression", dialect: "mysql" },
  })

  const result = decodeCompleteSchemaSnapshot(candidate)

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  const normalizedData = result.value.extensions[0]!.data as Record<string, unknown>
  expect(Object.prototype.hasOwnProperty.call(normalizedData, "__proto__")).toBe(true)
  expect(normalizedData["__proto__"]).toEqual({ kind: "expression", dialect: "mysql" })

  const encoded = encodeCompleteSchemaSnapshot(result.value)
  const decoded = decodeCompleteSchemaSnapshot(encoded)

  expect(decoded.ok).toBe(true)
  expect(encoded).toContain('"__proto__":{"dialect":"mysql","kind":"expression"}')
})

test("rejects unknown fields, future versions, and broken references", () => {
  const unknown = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as Record<
    string,
    unknown
  >

  unknown.unexpected = true
  const unknownResult = decodeCompleteSchemaSnapshot(unknown)

  expect(unknownResult.ok).toBe(false)
  if (!unknownResult.ok) {
    expect(unknownResult.diagnostics[0]?.code).toBe("unknown-field")
  }

  const future = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as Record<
    string,
    unknown
  >

  future.version = 3
  const futureResult = decodeCompleteSchemaSnapshot(future)

  expect(futureResult.ok).toBe(false)
  if (!futureResult.ok) {
    expect(futureResult.diagnostics[0]?.code).toBe("future-version")
  }

  const malformed = JSON.parse(encodeCompleteSchemaSnapshot(completeSnapshot())) as {
    comments: Array<{ object: { id: string } }>
  }

  malformed.comments[0]!.object.id = "missing"
  const malformedResult = decodeCompleteSchemaSnapshot(malformed)

  expect(malformedResult.ok).toBe(false)
  if (!malformedResult.ok) {
    expect(
      malformedResult.diagnostics.some((issue) => issue.code === "invalid-cross-reference"),
    ).toBe(true)
  }
})

test("maps normalized complete catalogs without turning deferred objects into tables", () => {
  const column: CatalogColumn = {
    kind: "column",
    id: "id",
    identitySource: "physical-name",
    physicalName: "id",
    ordinalPosition: 1,
    nullable: false,
    storage: { nativeType: "integer" },
  }
  const catalog: IntrospectionCatalog = {
    dialect: "postgresql",
    server: {
      product: "PostgreSQL",
      rawVersion: "16",
      capabilities,
    },
    namespace: {
      kind: "postgres-schema",
      name: "public",
    },
    tables: [
      {
        kind: "table",
        id: "accounts",
        identitySource: "physical-name",
        physicalName: "accounts",
        columns: [column],
        constraints: [],
        indexes: [],
      },
    ],
    views: [
      {
        kind: "view",
        id: "account_view",
        identitySource: "physical-name",
        physicalName: "account_view",
        columns: [],
        definition: {
          kind: "sql",
          dialect: "postgresql",
          text: "SELECT 1",
          provenance: {
            kind: "catalog",
            dialect: "postgresql",
          },
        },
      },
    ],
    deferredObjects: [
      {
        kind: "deferred-object",
        objectKind: "trigger",
        physicalName: "audit",
      },
    ],
    diagnostics: [],
  }
  const frozen = createCompleteIntrospectionCatalog(catalog)

  expect(Object.isFrozen(frozen)).toBe(true)
  expect(Object.isFrozen(frozen.tables[0])).toBe(true)
  const result = mapCatalogToCompleteSnapshot(catalog)

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables.map((table) => table.id)).toEqual(["accounts"])
  expect(result.snapshot.views.map((view) => view.id)).toEqual(["account_view"])
  expect(result.snapshot.deferredObjects[0]).toMatchObject({
    objectKind: "trigger",
    physicalName: "audit",
  })
})

test("retains typed catalog unknown fields as opaque snapshot records", () => {
  const column: CatalogColumn = {
    kind: "column",
    id: "id",
    identitySource: "physical-name",
    physicalName: "id",
    ordinalPosition: 1,
    nullable: false,
    storage: { nativeType: "integer" },
    unknownFields: [
      {
        name: "compression",
        value: "lz4",
        provenance: {
          kind: "catalog",
          dialect: "postgresql",
        },
      },
    ],
  }
  const catalog: IntrospectionCatalog = {
    dialect: "postgresql",
    server: {
      product: "PostgreSQL",
      rawVersion: "16",
      capabilities,
    },
    namespace: {
      kind: "postgres-schema",
      name: "public",
    },
    tables: [
      {
        kind: "table",
        id: "accounts",
        identitySource: "physical-name",
        physicalName: "accounts",
        columns: [column],
        constraints: [],
        indexes: [],
      },
    ],
    deferredObjects: [],
    diagnostics: [],
  }
  const result = mapCatalogToCompleteSnapshot(catalog)

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.opaqueObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "unknown-field",
        data: expect.objectContaining({
          field: "compression",
          value: "lz4",
        }),
      }),
    ]),
  )
})

test("reports non-canonical random object ordering", () => {
  const first = completeSnapshot()
  const secondTable = {
    ...first.tables[0]!,
    id: "users",
    physicalName: "users",
    columns: [],
    constraints: [],
  }
  const reordered = {
    ...first,
    tables: [secondTable, first.tables[0]!],
  }
  const result = decodeCompleteSchemaSnapshot(reordered)

  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.diagnostics.some((issue) => issue.code === "non-canonical")).toBe(true)
  }
})

test("validates every complete object family and typed extension boundary", () => {
  const base = completeSnapshot()
  const expanded: CompleteSchemaSnapshot = {
    ...base,
    views: [
      {
        ...base.views[0]!,
        dependencies: [
          {
            kind: "table",
            id: "accounts",
          },
        ],
      },
    ],
    sequences: [
      {
        kind: "sequence",
        id: "accounts_seq",
        physicalName: "accounts_seq",
        start: {
          kind: "literal",
          value: {
            kind: "number",
            value: "1",
          },
        },
        increment: {
          kind: "literal",
          value: {
            kind: "number",
            value: "1",
          },
        },
        ownedBy: {
          kind: "table",
          id: "accounts",
        },
      },
    ],
    enums: [
      {
        kind: "enum",
        id: "account_role",
        physicalName: "account_role",
        values: [
          {
            value: "member",
            ordinalPosition: 1,
          },
          {
            value: "owner",
            ordinalPosition: 2,
          },
        ],
      },
    ],
    domains: [
      {
        kind: "domain",
        id: "account_id",
        physicalName: "account_id",
        storage: {
          kind: "native",
          dialect: "postgresql",
          type: "integer",
        },
        constraints: [
          {
            kind: "check",
            id: "account_id_positive",
            physicalName: "account_id_positive",
            expression,
          },
        ],
      },
    ],
    collations: [
      {
        kind: "collation",
        id: "en_us",
        physicalName: "en_us",
        provider: "libc",
        locale: "en_US",
        deterministic: true,
      },
    ],
    triggers: [
      {
        kind: "trigger",
        id: "accounts_audit",
        physicalName: "accounts_audit",
        table: {
          kind: "table",
          id: "accounts",
        },
        timing: "after",
        events: ["insert"],
        body: expression,
      },
    ],
    routines: [
      {
        kind: "routine",
        id: "account_count",
        physicalName: "account_count",
        routineKind: "function",
        parameters: [],
        returnType: {
          kind: "native",
          dialect: "postgresql",
          type: "integer",
        },
        body: expression,
      },
    ],
    partitions: [
      {
        kind: "partition",
        id: "accounts_default",
        physicalName: "accounts_default",
        parent: {
          kind: "table",
          id: "accounts",
        },
        strategy: "range",
        bound: expression,
      },
    ],
    policies: [
      {
        kind: "policy",
        id: "accounts_policy",
        physicalName: "accounts_policy",
        table: {
          kind: "table",
          id: "accounts",
        },
        command: "select",
        using: expression,
      },
    ],
    extensions: [
      {
        kind: "extension",
        id: "postgis",
        physicalName: "postgis",
        extensionName: "postgis",
        data: { version: "3.4" },
      },
    ],
    deferredObjects: [
      {
        kind: "deferred-object",
        id: "foreign_table",
        objectKind: "foreign-table",
        physicalName: "foreign_table",
      },
    ],
    opaqueObjects: [
      {
        kind: "opaque-object",
        id: "custom_object",
        objectKind: "custom-object",
        physicalName: "custom_object",
        data: { observed: true },
        sql: expression,
      },
    ],
    ownership: [
      {
        kind: "ownership",
        id: "accounts-owner",
        physicalName: "accounts-owner",
        object: {
          kind: "table",
          id: "accounts",
        },
        owner: "app",
      },
    ],
  }

  expect(() => assertCompleteSchemaSnapshot(expanded)).not.toThrow()
})
