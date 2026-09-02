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
        options: {},
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
          kind: "column",
          column: "email",
          position: 1,
          direction: "DESC",
        },
      ],
    }),
  ])
})

test("uses mapped column IDs for index candidate keys and physical names for constraints", () => {
  const result = mapCatalogToSnapshot(
    catalog(
      [
        column("account-id", "id", 1),
        column("nullable-code", "code", 2, { nullable: true }),
      ],
      [
        {
          kind: "unique",
          id: "accounts_code_key",
          identitySource: "physical-name",
          physicalName: "accounts_code_key",
          columns: ["code"],
          nulls: "distinct",
        },
      ],
      [
        {
          kind: "index",
          id: "accounts_id_idx",
          identitySource: "physical-name",
          physicalName: "accounts_id_idx",
          unique: true,
          terms: [
            {
              kind: "column",
              column: "id",
              position: 1,
            },
          ],
        },
      ],
    ),
    { namespace: "public" },
  )

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables[0]?.indexes).toEqual([
    expect.objectContaining({
      candidateKey: true,
      terms: [expect.objectContaining({ column: "account-id" })],
    }),
  ])
  expect(result.snapshot.tables[0]?.constraints).toEqual([
    expect.objectContaining({
      kind: "unique-constraint",
      columns: ["nullable-code"],
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

test("returns a validated lossy snapshot only when an unsafe fact is omitted", () => {
  const missingColumnIndex: CatalogIndex = {
    kind: "index",
    id: "missing-column-index",
    identitySource: "physical-name",
    physicalName: "missing_column_index",
    unique: true,
    terms: [
      {
        kind: "column",
        column: "not_in_accounts",
        position: 1,
      },
    ],
  }
  const input = catalog([column("account_id", "account_id", 1)], [], [missingColumnIndex])

  const strict = mapCatalogToSnapshot(input, { namespace: "public" })

  expect(strict.ok).toBe(false)

  const lossy = mapCatalogToSnapshot(input, {
    namespace: "public",
    mode: "lossy",
  })

  expect(lossy.ok).toBe(true)
  if (!lossy.ok) {
    return
  }

  expect(lossy.lossy).toBe(true)
  expect(lossy.snapshot.tables[0]?.indexes).toEqual([])
  expect(lossy.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "lossy-mapping",
        severity: "warning",
      }),
    ]),
  )
})

test("remaps catalog-wide identities and every supported relationship", () => {
  const parent: IntrospectionCatalog["tables"][number] = {
    kind: "table",
    id: "parent-current",
    identitySource: "physical-name",
    physicalName: "parent",
    columns: [column("parent-column-current", "id", 1)],
    constraints: [
      {
        kind: "primary-key",
        id: "parent-constraint-current",
        identitySource: "physical-name",
        physicalName: "parent_pkey",
        columns: ["id"],
        backingIndex: {
          kind: "index",
          id: "parent-index-current",
          tableId: "parent-current",
        },
      },
    ],
    indexes: [
      {
        kind: "index",
        id: "parent-index-current",
        identitySource: "physical-name",
        physicalName: "parent_idx",
        unique: true,
        terms: [
          {
            kind: "column",
            column: "id",
            position: 1,
          },
        ],
        backingConstraint: {
          kind: "constraint",
          id: "parent-constraint-current",
          tableId: "parent-current",
        },
      },
    ],
  }
  const child: IntrospectionCatalog["tables"][number] = {
    kind: "table",
    id: "child-current",
    identitySource: "physical-name",
    physicalName: "child",
    columns: [
      column("child-column-current", "id", 1),
      column("child-parent-column-current", "parent_id", 2),
    ],
    constraints: [
      {
        kind: "foreign-key",
        id: "child-constraint-current",
        identitySource: "physical-name",
        physicalName: "child_parent_fk",
        columns: ["parent_id"],
        target: {
          table: "parent",
          columns: ["id"],
        },
      },
    ],
    indexes: [],
  }
  const richCatalog: IntrospectionCatalog = {
    dialect: "postgresql",
    server,
    namespace: {
      kind: "postgres-schema",
      name: "public",
    },
    tables: [parent, child],
    views: [
      {
        kind: "view",
        id: "view-current",
        identitySource: "physical-name",
        physicalName: "parent_view",
        columns: [column("view-column-current", "parent_id", 1)],
        definition: sql("SELECT id AS parent_id FROM parent"),
        dependencies: [
          {
            kind: "table",
            id: "parent-current",
          },
        ],
      },
    ],
    sequences: [
      {
        kind: "sequence",
        id: "sequence-current",
        identitySource: "physical-name",
        physicalName: "parent_sequence",
        ownedBy: {
          kind: "column",
          id: "child-parent-column-current",
        },
      },
    ],
    triggers: [
      {
        kind: "trigger",
        id: "trigger-current",
        identitySource: "physical-name",
        physicalName: "child_trigger",
        table: {
          kind: "table",
          id: "child-current",
        },
        timing: "after",
        events: ["insert"],
        body: sql("BEGIN END"),
      },
    ],
    routines: [
      {
        kind: "routine",
        id: "routine-current",
        identitySource: "physical-name",
        physicalName: "parent_routine",
        routineKind: "function",
        parameters: [],
        dependencies: [
          {
            kind: "view",
            id: "view-current",
          },
        ],
      },
    ],
    partitions: [
      {
        kind: "partition",
        id: "partition-current",
        identitySource: "physical-name",
        physicalName: "child_partition",
        parent: {
          kind: "table",
          id: "parent-current",
        },
        strategy: "range",
      },
    ],
    policies: [
      {
        kind: "policy",
        id: "policy-current",
        identitySource: "physical-name",
        physicalName: "child_policy",
        table: {
          kind: "table",
          id: "child-current",
        },
        command: "select",
      },
    ],
    comments: [
      {
        kind: "comment",
        id: "comment-current",
        object: {
          kind: "view",
          id: "view-current",
        },
        text: "view comment",
      },
    ],
    ownership: [
      {
        kind: "ownership",
        id: "ownership-current",
        object: {
          kind: "table",
          id: "parent-current",
        },
        owner: "owner",
      },
    ],
    deferredObjects: [],
    diagnostics: [],
  }
  const identityHints = [
    {
      kind: "table" as const,
      logicalId: "parent",
      physicalName: "parent",
    },
    {
      kind: "table" as const,
      logicalId: "child",
      physicalName: "child",
    },
    {
      kind: "column" as const,
      logicalId: "parentId",
      physicalName: "id",
      tablePhysicalName: "parent",
    },
    {
      kind: "column" as const,
      logicalId: "childId",
      physicalName: "id",
      tablePhysicalName: "child",
    },
    {
      kind: "column" as const,
      logicalId: "childParentId",
      physicalName: "parent_id",
      tablePhysicalName: "child",
    },
    {
      kind: "constraint" as const,
      logicalId: "parentKey",
      physicalName: "parent_pkey",
      tablePhysicalName: "parent",
    },
    {
      kind: "constraint" as const,
      logicalId: "childParentKey",
      physicalName: "child_parent_fk",
      tablePhysicalName: "child",
    },
    {
      kind: "index" as const,
      logicalId: "parentIndex",
      physicalName: "parent_idx",
      tablePhysicalName: "parent",
    },
    {
      kind: "view" as const,
      logicalId: "parentView",
      physicalName: "parent_view",
    },
    {
      kind: "sequence" as const,
      logicalId: "parentSequence",
      physicalName: "parent_sequence",
    },
    {
      kind: "trigger" as const,
      logicalId: "childTrigger",
      physicalName: "child_trigger",
    },
    {
      kind: "routine" as const,
      logicalId: "parentRoutine",
      physicalName: "parent_routine",
    },
    {
      kind: "partition" as const,
      logicalId: "childPartition",
      physicalName: "child_partition",
    },
    {
      kind: "policy" as const,
      logicalId: "childPolicy",
      physicalName: "child_policy",
    },
    {
      kind: "comment" as const,
      logicalId: "viewComment",
      physicalName: "comment-current",
    },
    {
      kind: "ownership" as const,
      logicalId: "tableOwnership",
      physicalName: "ownership-current",
    },
  ]
  const result = mapCatalogToSnapshot(richCatalog, {
    namespace: "public",
    identityHints,
    identityPolicy: {
      name: "test-policy",
      version: 1,
      fallback: "escaped",
      precedence: ["explicit-hint", "physical-name", "deterministic-fallback"],
    },
  })

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.namingPolicy).toEqual({
    name: "test-policy",
    version: 1,
  })
  expect(result.snapshot.tables.map((table) => table.id)).toEqual(["child", "parent"])
  expect(result.snapshot.tables[1]?.constraints[0]).toEqual(
    expect.objectContaining({
      id: "parentKey",
      backingIndex: {
        kind: "index",
        id: "parentIndex",
      },
    }),
  )
  expect(result.snapshot.tables[0]?.constraints[0]).toEqual(
    expect.objectContaining({
      id: "childParentKey",
      target: {
        table: {
          kind: "table",
          id: "parent",
        },
        columns: ["parentId"],
      },
    }),
  )
  expect(result.snapshot.views[0]?.dependencies).toEqual([
    {
      kind: "table",
      id: "parent",
    },
  ])
  expect(result.snapshot.sequences[0]?.ownedBy).toEqual({
    kind: "column",
    id: "childParentId",
  })
  expect(result.snapshot.triggers[0]?.table).toEqual({
    kind: "table",
    id: "child",
  })
  expect(result.snapshot.routines[0]?.dependencies).toEqual([
    {
      kind: "view",
      id: "parentView",
    },
  ])
  expect(result.snapshot.partitions[0]?.parent).toEqual({
    kind: "table",
    id: "parent",
  })
  expect(result.snapshot.policies[0]?.table).toEqual({
    kind: "table",
    id: "child",
  })
  expect(result.snapshot.comments[0]?.object).toEqual({
    kind: "view",
    id: "parentView",
  })
  expect(result.snapshot.ownership[0]?.object).toEqual({
    kind: "table",
    id: "parent",
  })
})

test("does not carry identities across dialect or namespace boundaries", () => {
  const previous = mapCatalogToSnapshot(
    {
      ...catalog([column("old-column", "account_id", 1)]),
      tables: [
        {
          ...catalog([column("old-column", "account_id", 1)]).tables[0]!,
          id: "old-table",
        },
      ],
    },
    { namespace: "public" },
  )

  expect(previous.ok).toBe(true)
  if (!previous.ok) {
    return
  }

  const result = mapCatalogToSnapshot(
    {
      ...catalog([column("current-column", "account_id", 1)]),
      tables: [
        {
          ...catalog([column("current-column", "account_id", 1)]).tables[0]!,
          id: "current-table",
        },
      ],
    },
    {
      namespace: "public",
      mode: "lossy",
      previousSnapshot: {
        ...previous.snapshot,
        dialect: {
          name: "sqlite",
          version: 1,
        },
        namespace: {
          kind: "postgres-schema",
          name: "other",
        },
      },
    },
  )

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables[0]?.id).toBe("accounts")
  expect(result.snapshot.tables[0]?.columns[0]?.id).toBe("account_id")
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "lossy-mapping",
        severity: "warning",
      }),
    ]),
  )
})

test("only marks a unique index as a candidate key when its whole key is proven", () => {
  const indexes: CatalogIndex[] = [
    {
      kind: "index",
      id: "required-key",
      identitySource: "physical-name",
      physicalName: "required_key",
      unique: true,
      terms: [
        {
          kind: "column",
          column: "required",
          position: 1,
        },
      ],
    },
    {
      kind: "index",
      id: "nullable-key",
      identitySource: "physical-name",
      physicalName: "nullable_key",
      unique: true,
      terms: [
        {
          kind: "column",
          column: "nullable",
          position: 1,
        },
      ],
    },
    {
      kind: "index",
      id: "expression-key",
      identitySource: "physical-name",
      physicalName: "expression_key",
      unique: true,
      terms: [
        {
          kind: "expression",
          expression: sql("lower(required)"),
          position: 1,
        },
      ],
    },
    {
      kind: "index",
      id: "partial-key",
      identitySource: "physical-name",
      physicalName: "partial_key",
      unique: true,
      terms: [
        {
          kind: "column",
          column: "required",
          position: 1,
        },
      ],
      predicate: sql("required IS NOT NULL"),
    },
  ]
  const result = mapCatalogToSnapshot(
    catalog(
      [
        column("required-id", "required", 1),
        column("nullable-id", "nullable", 2, { nullable: true }),
      ],
      [],
      indexes,
    ),
    { namespace: "public" },
  )

  expect(result.ok).toBe(true)
  if (!result.ok) {
    return
  }

  expect(result.snapshot.tables[0]?.indexes.map((index) => [index.id, index.candidateKey])).toEqual(
    [
      ["expression-key", false],
      ["nullable-key", false],
      ["partial-key", false],
      ["required-key", true],
    ],
  )
})
