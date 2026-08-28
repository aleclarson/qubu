import { expect, test } from "vitest"

import { mapCatalogToSnapshot } from "../src/introspection/index.ts"
import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogIndex,
  CatalogSqlExpression,
  IntrospectionCatalog,
} from "../src/introspection/index.ts"

const sql = (text: string): CatalogSqlExpression => ({
  kind: "sql",
  dialect: "postgresql",
  text,
  provenance: {
    kind: "catalog",
    dialect: "postgresql",
  },
})

const server = {
  product: "PostgreSQL",
  rawVersion: "16.0",
  parsedVersion: {
    major: 16,
    minor: 0,
  },
  capabilities: {
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
  },
}

const column = (
  id: string,
  physicalName: string,
  ordinalPosition: number,
  facts: Partial<CatalogColumn> = {},
): CatalogColumn => ({
  kind: "column",
  id,
  identitySource: "physical-name",
  physicalName,
  ordinalPosition,
  nullable: false,
  storage: { nativeType: "integer" },
  ...facts,
})

const catalog = (
  columns: readonly CatalogColumn[],
  constraints: readonly CatalogConstraint[] = [],
  indexes: readonly CatalogIndex[] = [],
): IntrospectionCatalog => ({
  dialect: "postgresql",
  server,
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
      columns,
      constraints,
      indexes,
    },
  ],
  deferredObjects: [],
  diagnostics: [],
})

test("maps falsy defaults and native storage without dropping values", () => {
  const result = mapCatalogToSnapshot(
    catalog([
      column("empty", "empty", 4, {
        storage: { nativeType: "text" },
        default: {
          kind: "literal",
          value: "",
        },
      }),
      column("flag", "flag", 2, {
        default: {
          kind: "literal",
          value: false,
        },
      }),
      column("missing", "missing", 3, {
        default: {
          kind: "literal",
          value: null,
        },
      }),
      column("count", "count", 1, {
        default: {
          kind: "literal",
          value: 0,
        },
      }),
      column("created", "created", 5, {
        storage: { nativeType: "timestamp with time zone" },
        default: {
          kind: "expression",
          expression: sql("CURRENT_TIMESTAMP"),
        },
      }),
    ]),
    { namespace: "public" },
  )

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.dialect).toEqual({
    name: "postgresql",
    version: 1,
  })
  expect(result.snapshot.tables[0]?.columns).toEqual([
    expect.objectContaining({
      id: "count",
      storage: {
        kind: "native",
        dialect: "postgresql",
        type: "integer",
      },
      default: {
        kind: "literal",
        value: {
          kind: "number",
          value: "0",
        },
      },
    }),
    expect.objectContaining({
      id: "created",
      storage: {
        kind: "native",
        dialect: "postgresql",
        type: "timestamp with time zone",
      },
      default: {
        kind: "expression",
        expression: expect.objectContaining({ sql: "CURRENT_TIMESTAMP" }),
      },
    }),
    expect.objectContaining({
      id: "empty",
      default: {
        kind: "literal",
        value: {
          kind: "string",
          value: "",
        },
      },
    }),
    expect.objectContaining({
      id: "flag",
      default: {
        kind: "literal",
        value: {
          kind: "boolean",
          value: false,
        },
      },
    }),
    expect.objectContaining({
      id: "missing",
      default: {
        kind: "literal",
        value: { kind: "null" },
      },
    }),
  ])
})

test("maps default, generated, and identity write flags independently", () => {
  const result = mapCatalogToSnapshot(
    catalog([
      column("defaulted", "defaulted", 1, {
        default: {
          kind: "literal",
          value: 1,
        },
      }),
      column("generated_value", "generated_value", 2, {
        generated: {
          kind: "generated",
          expression: sql("defaulted + 1"),
          mode: "stored",
        },
      }),
      column("identity_id", "identity_id", 3, {
        identity: {
          kind: "identity",
          generation: "by-default",
          options: {},
        },
      }),
    ]),
    { namespace: "public" },
  )

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables[0]?.columns).toEqual([
    expect.objectContaining({
      id: "defaulted",
      hasDefault: true,
      generated: false,
      default: {
        kind: "literal",
        value: {
          kind: "number",
          value: "1",
        },
      },
    }),
    expect.objectContaining({
      id: "generated_value",
      hasDefault: false,
      generated: true,
      generatedColumn: expect.objectContaining({ mode: "stored" }),
    }),
    expect.objectContaining({
      id: "identity_id",
      hasDefault: false,
      generated: true,
      identity: {
        kind: "identity",
        generation: "by-default",
      },
    }),
  ])
})

test("carries table and column identities from a previous snapshot", () => {
  const initial = mapCatalogToSnapshot(catalog([column("account_id", "account_id", 1)]), {
    namespace: "public",
  })

  expect(initial.ok).toBe(true)
  if (!initial.ok) {
    return
  }

  const baseCurrent = catalog([column("new-column-id", "account_id", 1)])
  const current: IntrospectionCatalog = {
    ...baseCurrent,
    tables: [
      {
        ...baseCurrent.tables[0]!,
        id: "new-table-id",
      },
    ],
  }
  const result = mapCatalogToSnapshot(current, {
    namespace: "public",
    previousSnapshot: initial.snapshot,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables[0]?.id).toBe("accounts")
  expect(result.snapshot.tables[0]?.columns[0]?.id).toBe("account_id")
})

test("maps constraints and ordered index terms to Snapshot v1", () => {
  const constraints: CatalogConstraint[] = [
    {
      kind: "primary-key",
      id: "accounts_pkey",
      identitySource: "physical-name",
      physicalName: "accounts_pkey",
      columns: ["id"],
    },
  ]
  const indexes: CatalogIndex[] = [
    {
      kind: "index",
      id: "accounts_email_idx",
      identitySource: "physical-name",
      physicalName: "accounts_email_idx",
      unique: true,
      terms: [
        {
          kind: "column",
          column: "email",
          position: 1,
          direction: "DESC",
        },
      ],
      includedColumns: ["id"],
    },
  ]
  const result = mapCatalogToSnapshot(
    catalog(
      [column("id", "id", 1), column("email", "email", 2, { storage: { nativeType: "text" } })],
      constraints,
      indexes,
    ),
    { namespace: "public" },
  )

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables[0]?.constraints).toEqual([
    expect.objectContaining({
      kind: "primary-key",
      columns: ["id"],
    }),
  ])
  expect(result.snapshot.tables[0]?.indexes).toEqual([
    expect.objectContaining({
      unique: true,
      candidateKey: true,
      includedColumns: ["id"],
      terms: [
        {
          kind: "order",
          expression: {
            kind: "column",
            column: "email",
          },
          direction: "DESC",
        },
      ],
    }),
  ])
})

test("rejects unresolved foreign-key references in strict mode", () => {
  const constraint: CatalogConstraint = {
    kind: "foreign-key",
    id: "accounts_owner_fk",
    identitySource: "physical-name",
    physicalName: "accounts_owner_fk",
    columns: ["owner_id"],
    target: {
      table: "owners",
      columns: ["id"],
    },
  }
  const result = mapCatalogToSnapshot(catalog([column("owner_id", "owner_id", 1)], [constraint]), {
    namespace: "public",
  })

  expect(result.ok).toBe(false)
  if (result.ok) {
    return
  }

  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unresolved-reference",
        severity: "error",
      }),
    ]),
  )
})
