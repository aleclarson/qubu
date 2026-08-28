import { mapCatalogToSnapshot } from "../src/introspection/index.ts"
import type {
  CatalogColumn,
  CatalogConstraint,
  CatalogIndex,
  CatalogSqlExpression,
  CatalogTable,
  IntrospectionCatalog,
  IntrospectionSuccess,
} from "../src/introspection/index.ts"

const dialect = "postgresql" as const

const sql = (text: string): CatalogSqlExpression => ({
  kind: "sql",
  dialect,
  text,
  provenance: {
    kind: "catalog",
    dialect,
  },
})

const column = (
  physicalName: string,
  ordinalPosition: number,
  storage: string,
  facts: Partial<CatalogColumn> = {},
): CatalogColumn => ({
  kind: "column",
  id: physicalName,
  identitySource: "physical-name",
  physicalName,
  ordinalPosition,
  nullable: false,
  storage: { nativeType: storage },
  ...facts,
})

const table = (
  physicalName: string,
  columns: readonly CatalogColumn[],
  constraints: readonly CatalogConstraint[],
  indexes: readonly CatalogIndex[] = [],
): CatalogTable => ({
  kind: "table",
  id: physicalName,
  identitySource: "physical-name",
  physicalName,
  columns,
  constraints,
  indexes,
})

const parentRecords = table(
  "parent_records",
  [
    column("id", 1, "integer", {
      identity: {
        kind: "identity",
        generation: "always",
        options: {},
        dialect: {
          dialect,
          version: 1,
          data: { sequenceOwned: true },
        },
      },
    }),
  ],
  [
    {
      kind: "primary-key",
      id: "parent_records_pkey",
      identitySource: "physical-name",
      physicalName: "parent_records_pkey",
      columns: ["id"],
    },
  ],
)

const accountEntries = table(
  "account_entries",
  [
    column("id", 1, "integer"),
    column("parent_id", 2, "integer", {
      nullable: true,
      default: {
        kind: "literal",
        value: 0,
      },
    }),
    column("status", 3, "text", {
      default: {
        kind: "literal",
        value: "pending",
      },
    }),
    column("slug", 4, "text", {
      generated: {
        kind: "generated",
        expression: sql("lower(status)"),
        mode: "stored",
      },
    }),
    column("updated_at", 5, "timestamp with time zone", {
      default: {
        kind: "expression",
        expression: sql("CURRENT_TIMESTAMP"),
      },
    }),
  ],
  [
    {
      kind: "primary-key",
      id: "account_entries_pkey",
      identitySource: "physical-name",
      physicalName: "account_entries_pkey",
      columns: ["id"],
    },
    {
      kind: "unique",
      id: "account_entries_slug_key",
      identitySource: "physical-name",
      physicalName: "account_entries_slug_key",
      columns: ["slug"],
      nulls: "distinct",
    },
    {
      kind: "unique",
      id: "account_entries_parent_key",
      identitySource: "physical-name",
      physicalName: "account_entries_parent_key",
      columns: ["parent_id"],
      nulls: "distinct",
    },
    {
      kind: "foreign-key",
      id: "account_entries_parent_fk",
      identitySource: "physical-name",
      physicalName: "account_entries_parent_fk",
      columns: ["parent_id"],
      target: {
        table: "parent_records",
        columns: ["id"],
      },
      onUpdate: "cascade",
      onDelete: "set-null",
      match: "full",
      deferrable: true,
      initially: "deferred",
      dialect: {
        dialect,
        version: 1,
        data: { notValid: true },
      },
    },
    {
      kind: "check",
      id: "account_entries_status_check",
      identitySource: "physical-name",
      physicalName: "account_entries_status_check",
      expression: sql("CHECK (status <> '*/\\nexport const hacked = true')"),
    },
  ],
  [
    {
      kind: "index",
      id: "account_entries_search_idx",
      identitySource: "physical-name",
      physicalName: "account_entries_search_idx",
      unique: false,
      terms: [
        {
          kind: "column",
          column: "parent_id",
          position: 1,
          direction: "DESC",
          nulls: "FIRST",
        },
        {
          kind: "expression",
          expression: sql("lower(status)"),
          position: 2,
        },
      ],
      predicate: sql("parent_id IS NOT NULL"),
      includedColumns: ["status"],
      dialect: {
        dialect,
        version: 1,
        data: { method: "btree" },
      },
    },
  ],
)

export const codegenCatalog: IntrospectionCatalog = {
  dialect,
  server: {
    product: "PostgreSQL",
    rawVersion: "16.0",
    capabilities: {
      generatedColumns: true,
      identityMetadata: true,
      checkConstraints: true,
      checkConstraintEnforcement: "enforced",
      expressionDecompilation: true,
      indexExpressions: true,
      indexPredicates: true,
      indexIncludedColumns: true,
      namespaces: true,
      visibility: "complete",
    },
  },
  namespace: {
    kind: "postgres-schema",
    name: "app_data",
  },
  tables: [parentRecords, accountEntries],
  deferredObjects: [
    {
      kind: "deferred-object",
      objectKind: "view",
      id: "account_summary",
      identitySource: "physical-name",
      physicalName: "account_summary",
    },
  ],
  diagnostics: [
    {
      severity: "warning",
      code: "unmodeled-object",
      message: "A view remains outside Snapshot v1",
      path: ["deferredObjects", 0],
    },
  ],
}

const result = mapCatalogToSnapshot(codegenCatalog, {
  namespace: "app_data",
})

if (!result.ok) {
  throw new Error(result.diagnostics.map((issue) => issue.message).join("\n"))
}

export const codegenInput: IntrospectionSuccess = result

const alphaRecords = table(
  "alpha_records",
  [column("id", 1, "integer"), column("beta_id", 2, "integer")],
  [
    {
      kind: "primary-key",
      id: "alpha_records_pkey",
      identitySource: "physical-name",
      physicalName: "alpha_records_pkey",
      columns: ["id"],
    },
    {
      kind: "foreign-key",
      id: "alpha_records_beta_fk",
      identitySource: "physical-name",
      physicalName: "alpha_records_beta_fk",
      columns: ["beta_id"],
      target: {
        table: "beta_records",
        columns: ["id"],
      },
    },
  ],
)

const betaRecords = table(
  "beta_records",
  [column("id", 1, "integer"), column("alpha_id", 2, "integer")],
  [
    {
      kind: "foreign-key",
      id: "beta_records_alpha_fk",
      identitySource: "physical-name",
      physicalName: "beta_records_alpha_fk",
      columns: ["alpha_id"],
      target: {
        table: "alpha_records",
        columns: ["id"],
      },
    },
  ],
  [
    {
      kind: "index",
      id: "beta_records_id_idx",
      identitySource: "physical-name",
      physicalName: "beta_records_id_idx",
      unique: true,
      terms: [
        {
          kind: "column",
          column: "id",
          position: 1,
        },
      ],
      includedColumns: ["alpha_id"],
    },
  ],
)

export const cycleCodegenCatalog: IntrospectionCatalog = {
  ...codegenCatalog,
  namespace: {
    kind: "postgres-schema",
    name: "cycle_data",
  },
  tables: [alphaRecords, betaRecords],
  deferredObjects: [],
  diagnostics: [],
}

const cycleResult = mapCatalogToSnapshot(cycleCodegenCatalog, {
  namespace: "cycle_data",
})

if (!cycleResult.ok) {
  throw new Error(cycleResult.diagnostics.map((issue) => issue.message).join("\n"))
}

export const cycleCodegenInput: IntrospectionSuccess = cycleResult

export const sqliteCodegenCatalog: IntrospectionCatalog = {
  ...codegenCatalog,
  dialect: "sqlite",
  server: {
    ...codegenCatalog.server,
    product: "SQLite",
    rawVersion: "3.45.0",
  },
  namespace: {
    kind: "sqlite-database",
    name: "main",
  },
  tables: [
    table("empty_records", [], []),
    table("sqlite_records", [column("record_id", 1, "INTEGER")], [], []),
  ],
  deferredObjects: [],
  diagnostics: [],
}

const sqliteResult = mapCatalogToSnapshot(sqliteCodegenCatalog, {
  namespace: "main",
})

if (!sqliteResult.ok) {
  throw new Error(sqliteResult.diagnostics.map((issue) => issue.message).join("\n"))
}

export const sqliteCodegenInput: IntrospectionSuccess = sqliteResult

export const emptyCodegenCatalog: IntrospectionCatalog = {
  ...codegenCatalog,
  namespace: {
    kind: "postgres-schema",
    name: "empty_data",
  },
  tables: [],
  deferredObjects: [],
  diagnostics: [],
}

const emptyResult = mapCatalogToSnapshot(emptyCodegenCatalog, {
  namespace: "empty_data",
})

if (!emptyResult.ok) {
  throw new Error(emptyResult.diagnostics.map((issue) => issue.message).join("\n"))
}

export const emptyCodegenInput: IntrospectionSuccess = emptyResult
