import { expect, test } from "vitest"

import { mapCatalogToCompleteSnapshot } from "../src/introspection/index.ts"
import type {
  CatalogConnection,
  CatalogQuery,
  IntrospectionOptions,
} from "../src/introspection/index.ts"
import {
  postgresColumnsQuery,
  postgresCollationsQuery,
  postgresConstraintsQuery,
  postgresConstraintsQueryWithoutNullsNotDistinct,
  postgresDomainConstraintsQuery,
  postgresDomainsQuery,
  postgresEnumsQuery,
  postgresExtensionsQuery,
  postgresIdentitiesQuery,
  postgresIndexesQuery,
  postgresMetadataQuery,
  postgresPartitionsQuery,
  postgresPoliciesQuery,
  postgresRelationsQuery,
  postgresRoutinesQuery,
  postgresRoutineParametersQuery,
  postgresSequencesQuery,
  postgresServerQuery,
  postgresTriggersQuery,
  postgresViewsQuery,
  readCatalog,
} from "../src/introspection/postgres.ts"

type Row = Readonly<Record<string, unknown>>

function connection(
  rows: Readonly<Record<string, readonly Row[]>>,
  dialect: CatalogConnection["dialect"] = "postgresql",
) {
  const calls: CatalogQuery[] = []
  const value: CatalogConnection = {
    dialect,
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      const result = Object.entries(rows).find(([query]) => statement.text.includes(query))?.[1]

      return (result ?? []) as readonly TRow[]
    },
  }

  return {
    connection: value,
    calls,
  }
}

function options(namespace = "tenant"): IntrospectionOptions {
  return { namespace }
}

function exactConnection(
  rows: Readonly<Record<string, readonly Row[]>>,
  dialect: CatalogConnection["dialect"] = "postgresql",
) {
  const calls: CatalogQuery[] = []
  const value: CatalogConnection = {
    dialect,
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      return (rows[statement.text] ?? []) as readonly TRow[]
    },
  }

  return {
    connection: value,
    calls,
  }
}

const completeRows = {
  "current_setting('server_version_num')": [
    {
      server_version_num: "160002",
      server_version: "16.0",
    },
  ],
  "FROM pg_class c": [
    {
      oid: "10",
      namespace: "tenant",
      relname: "accounts",
      relkind: "r",
    },
    {
      oid: "20",
      namespace: "tenant",
      relname: "owners",
      relkind: "r",
    },
    {
      oid: "30",
      namespace: "tenant",
      relname: "account_view",
      relkind: "v",
    },
  ],
  "FROM pg_attribute a": [
    {
      table_oid: "10",
      ordinal_position: 1,
      physical_name: "id",
      nullable: false,
      native_type: "integer",
      attidentity: "a",
      attgenerated: "",
      default_expression: null,
    },
    {
      table_oid: "10",
      ordinal_position: 2,
      physical_name: "owner_id",
      nullable: true,
      native_type: "integer",
      attidentity: "",
      attgenerated: "",
      default_expression: "0",
    },
    {
      table_oid: "10",
      ordinal_position: 3,
      physical_name: "display_name",
      nullable: false,
      native_type: "text",
      attidentity: "",
      attgenerated: "s",
      default_expression: "lower('ACCOUNTS')",
    },
    {
      table_oid: "20",
      ordinal_position: 1,
      physical_name: "id",
      nullable: false,
      native_type: "bigint",
      attidentity: "d",
      attgenerated: "",
      default_expression: null,
    },
    {
      table_oid: "10",
      ordinal_position: 4,
      physical_name: "search_name",
      nullable: false,
      native_type: "text",
      attidentity: "",
      attgenerated: "v",
      default_expression: "upper('ACCOUNTS')",
    },
  ],
  "FROM pg_constraint con": [
    {
      oid: "101",
      table_oid: "10",
      physical_name: "accounts_pkey",
      contype: "p",
      conkey: [1],
      condeferrable: false,
      condeferred: false,
      convalidated: true,
    },
    {
      oid: "102",
      table_oid: "10",
      physical_name: "accounts_owner_fk",
      contype: "f",
      conkey: [2],
      target_table_oid: "20",
      confkey: [1],
      confupdtype: "c",
      confdeltype: "n",
      confmatchtype: "s",
      condeferrable: true,
      condeferred: true,
      convalidated: false,
    },
    {
      oid: "103",
      table_oid: "10",
      physical_name: "accounts_name_check",
      contype: "c",
      conkey: [],
      definition: "CHECK (display_name <> '')",
      condeferrable: false,
      condeferred: false,
      convalidated: true,
    },
    {
      oid: "104",
      table_oid: "10",
      physical_name: "accounts_owner_unique",
      contype: "u",
      conkey: [2],
      indnullsnotdistinct: true,
      condeferrable: false,
      condeferred: false,
      convalidated: true,
    },
  ],
  "FROM pg_index i": [
    {
      index_oid: "201",
      table_oid: "10",
      physical_name: "accounts_owner_idx",
      indisunique: false,
      indnkeyatts: 1,
      indnatts: 2,
      method: "btree",
      predicate: "owner_id IS NOT NULL",
      position: 1,
      attnum: 2,
      indoption: 3,
      term_definition: "owner_id DESC NULLS FIRST",
    },
    {
      index_oid: "201",
      table_oid: "10",
      physical_name: "accounts_owner_idx",
      indisunique: false,
      indnkeyatts: 1,
      indnatts: 2,
      method: "btree",
      predicate: "owner_id IS NOT NULL",
      position: 2,
      attnum: 1,
      indoption: 0,
      term_definition: "INCLUDE (id)",
    },
  ],
}

test("normalizes PostgreSQL relations, columns, defaults, generated columns, and identities", async () => {
  const fake = connection(completeRows)
  const catalog = await readCatalog(fake.connection, options())
  const accounts = catalog.tables[0]!
  const columns = accounts.columns

  expect(catalog.server).toMatchObject({
    product: "postgresql",
    rawVersion: "16.0",
    parsedVersion: { major: 16 },
    capabilities: {
      generatedColumns: true,
      identityMetadata: true,
    },
  })
  expect(accounts.physicalName).toBe("accounts")
  expect(columns).toEqual([
    expect.objectContaining({
      physicalName: "id",
      identity: {
        kind: "identity",
        generation: "always",
        options: {},
      },
    }),
    expect.objectContaining({
      physicalName: "owner_id",
      default: expect.objectContaining({ kind: "expression" }),
    }),
    expect.objectContaining({
      physicalName: "display_name",
      generated: expect.objectContaining({ mode: "stored" }),
    }),
    expect.objectContaining({
      physicalName: "search_name",
      generated: expect.objectContaining({ mode: "virtual" }),
    }),
  ])
  for (const physicalName of ["display_name", "search_name"]) {
    expect(columns.find((column) => column.physicalName === physicalName)).not.toHaveProperty(
      "default",
    )
  }

  expect(catalog.deferredObjects).toEqual([
    expect.objectContaining({
      objectKind: "view",
      physicalName: "account_view",
    }),
  ])
  expect(fake.calls.every((call) => call.text.includes("$1") || call.parameters.length === 0)).toBe(
    true,
  )
  expect(fake.calls.filter((call) => call.parameters[0] === "tenant")).toHaveLength(18)
  expect(
    new Set(fake.calls.filter((call) => call.parameters[0] === "tenant").map((call) => call.text)),
  ).toEqual(
    new Set([
      postgresRelationsQuery,
      postgresViewsQuery,
      postgresColumnsQuery,
      postgresIdentitiesQuery,
      postgresConstraintsQuery,
      postgresIndexesQuery,
      postgresSequencesQuery,
      postgresEnumsQuery,
      postgresDomainsQuery,
      postgresDomainConstraintsQuery,
      postgresCollationsQuery,
      postgresTriggersQuery,
      postgresRoutinesQuery,
      postgresRoutineParametersQuery,
      postgresPartitionsQuery,
      postgresPoliciesQuery,
      postgresExtensionsQuery,
      postgresMetadataQuery,
    ]),
  )
})

test("normalizes constraints, foreign keys, checks, predicates, terms, and included columns", async () => {
  const { connection: fake } = connection(completeRows)
  const catalog = await readCatalog(fake, options())
  const accounts = catalog.tables[0]!

  expect(accounts.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "primary-key",
        columns: ["id"],
      }),
      expect.objectContaining({
        kind: "foreign-key",
        columns: ["owner_id"],
        target: {
          table: "owners",
          columns: ["id"],
        },
        onUpdate: "cascade",
        onDelete: "set-null",
        match: "simple",
        deferrable: true,
        initially: "deferred",
        validated: false,
      }),
      expect.objectContaining({
        kind: "check",
        expression: expect.objectContaining({
          text: "CHECK (display_name <> '')",
        }),
      }),
      expect.objectContaining({
        kind: "unique",
        columns: ["owner_id"],
        nulls: "not-distinct",
      }),
    ]),
  )
  expect(accounts.indexes).toEqual([
    expect.objectContaining({
      physicalName: "accounts_owner_idx",
      predicate: expect.objectContaining({ text: "owner_id IS NOT NULL" }),
      includedColumns: ["id"],
      terms: [
        expect.objectContaining({
          kind: "column",
          column: "owner_id",
          direction: "DESC",
          nulls: "FIRST",
        }),
      ],
    }),
  ])
})

test("gates unsupported PostgreSQL versions", async () => {
  const fake = connection({
    "current_setting('server_version_num')": [
      {
        server_version_num: "110022",
        server_version: "11.22",
      },
    ],
  })
  const catalog = await readCatalog(fake.connection, options())

  expect(catalog.server.capabilities.generatedColumns).toBe(false)
  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unsupported-server",
        severity: "error",
      }),
    ]),
  )
})

test("selects PostgreSQL constraint metadata supported by the server version", async () => {
  const fake = exactConnection({
    [postgresServerQuery]: [
      {
        server_version_num: "140012",
        server_version: "14.12",
      },
    ],
    [postgresRelationsQuery]: [
      {
        oid: "10",
        namespace: "tenant",
        relname: "items",
        relkind: "r",
      },
    ],
    [postgresColumnsQuery]: [
      {
        table_oid: "10",
        ordinal_position: 1,
        physical_name: "id",
        nullable: false,
        native_type: "integer",
      },
    ],
    [postgresConstraintsQueryWithoutNullsNotDistinct]: [
      {
        oid: "101",
        table_oid: "10",
        physical_name: "items_id_unique",
        contype: "u",
        conkey: [1],
        condeferrable: false,
        condeferred: false,
        convalidated: true,
      },
    ],
  })
  const catalog = await readCatalog(fake.connection, options())

  expect(fake.calls.find((call) => call.text.includes("FROM pg_constraint con"))?.text).toBe(
    postgresConstraintsQueryWithoutNullsNotDistinct,
  )
  expect(
    fake.calls.find((call) => call.text.includes("FROM pg_constraint con"))?.text,
  ).not.toContain("indnullsnotdistinct")
  expect(catalog.tables[0]?.constraints).toEqual([
    expect.objectContaining({
      kind: "unique",
      columns: ["id"],
      nulls: "distinct",
    }),
  ])
})

test("retains PostgreSQL unsupported relationships and exact unavailable facts", async () => {
  const fake = exactConnection({
    [postgresServerQuery]: [
      {
        server_version_num: "160002",
        server_version: "16.0",
      },
    ],
    [postgresRelationsQuery]: [
      {
        oid: "10",
        namespace: "tenant",
        relname: "parent",
        relkind: "r",
      },
      {
        oid: "11",
        namespace: "tenant",
        relname: "child",
        relkind: "r",
      },
      {
        oid: "12",
        namespace: "tenant",
        relname: "parent_2026",
        relkind: "r",
        relispartition: true,
      },
      {
        oid: "20",
        namespace: "tenant",
        relname: "missing_view",
        relkind: "v",
      },
    ],
    [postgresViewsQuery]: [
      {
        oid: "20",
        namespace: "tenant",
        physical_name: "missing_view",
        relkind: "v",
        definition: null,
      },
    ],
    [postgresColumnsQuery]: [
      {
        table_oid: "10",
        ordinal_position: 1,
        physical_name: "id",
        nullable: false,
        native_type: "integer",
      },
      {
        table_oid: "10",
        ordinal_position: 2,
        physical_name: "code",
        nullable: false,
        native_type: "text",
      },
    ],
    [postgresConstraintsQuery]: [
      {
        oid: "101",
        table_oid: "10",
        physical_name: "parent_no_overlap",
        contype: "x",
        conkey: [1],
        definition: "EXCLUDE USING gist (id WITH =)",
      },
      {
        oid: "102",
        table_oid: "10",
        physical_name: "parent_check",
        contype: "c",
        conkey: [],
        definition: null,
      },
    ],
    [postgresDomainsQuery]: [
      {
        oid: "301",
        namespace: "tenant",
        physical_name: "status",
        native_type: "text",
        nullable: true,
        default_expression: "now()",
      },
      {
        oid: "303",
        namespace: "tenant",
        physical_name: "enabled",
        native_type: "boolean",
        nullable: false,
        default_expression: "TRUE",
      },
    ],
    [postgresDomainConstraintsQuery]: [
      {
        oid: "302",
        domain_oid: "301",
        physical_name: "status_check",
        definition: null,
      },
    ],
    [postgresPartitionsQuery]: [
      {
        partition_oid: "12",
        parent_oid: "10",
        namespace: "tenant",
        physical_name: "parent_2026",
        partstrat: "r",
        key_attributes: "[0:1]={1,0}",
        key_definition: "RANGE (id, lower(code))",
        bound: "FOR VALUES FROM (1, 2) TO (3, 4)",
        relispartition: true,
        relkind: "r",
      },
      {
        partition_oid: "11",
        parent_oid: "10",
        namespace: "tenant",
        physical_name: "child",
        partstrat: null,
        key_attributes: null,
        key_definition: null,
        relispartition: false,
        relkind: "r",
      },
    ],
  })
  const catalog = await readCatalog(fake.connection, options())
  const partition = catalog.partitions?.[0]

  expect(catalog.opaqueObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "exclusion-constraint",
        physicalName: "parent_no_overlap",
        sql: expect.objectContaining({ text: "EXCLUDE USING gist (id WITH =)" }),
      }),
      expect.objectContaining({
        objectKind: "constraint",
        physicalName: "parent_check",
      }),
      expect.objectContaining({
        objectKind: "domain-constraint",
        physicalName: "status_check",
        data: expect.objectContaining({ definitionAvailable: false }),
      }),
      expect.objectContaining({
        objectKind: "ordinary-inheritance",
        physicalName: "child",
      }),
    ]),
  )
  expect(partition).toMatchObject({
    physicalName: "parent_2026",
    parent: { id: "parent" },
    unknownFields: [
      expect.objectContaining({
        name: "keyDefinition",
        value: expect.objectContaining({
          text: "RANGE (id, lower(code))",
        }),
      }),
    ],
  })
  expect(partition).not.toHaveProperty("keyColumns")
  expect(catalog.domains?.[0]?.default).toEqual({
    kind: "expression",
    expression: expect.objectContaining({
      text: "now()",
    }),
  })
  expect(catalog.domains?.find((domain) => domain.physicalName === "enabled")?.default).toEqual({
    kind: "literal",
    value: true,
  })
  expect(catalog.deferredObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "view",
        physicalName: "missing_view",
      }),
    ]),
  )
  expect(JSON.stringify(catalog)).not.toContain("CHECK (true)")
  expect(JSON.stringify(catalog)).not.toContain("unavailable")
})

test("reports query failures without exposing driver errors", async () => {
  const calls: CatalogQuery[] = []
  const fake: CatalogConnection = {
    dialect: "postgresql",
    async query<TRow extends Row = Row>(statement: CatalogQuery) {
      calls.push(statement)
      if (statement.text === postgresServerQuery) {
        return [
          {
            server_version_num: "160000",
            server_version: "16.0",
          },
        ] as unknown as readonly TRow[]
      }

      if (statement.text === postgresRelationsQuery) {
        return []
      }

      if (statement.text === postgresColumnsQuery) {
        return []
      }

      if (statement.text === postgresConstraintsQuery) {
        throw new Error("password=secret")
      }

      return []
    },
  }
  const catalog = await readCatalog(fake, options("private"))

  expect(catalog.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "query-failed",
        path: ["constraints"],
      }),
    ]),
  )
  expect(JSON.stringify(catalog.diagnostics)).not.toContain("password")
  expect(calls.find((call) => call.text === postgresConstraintsQuery)?.parameters).toEqual([
    "private",
  ])
})

test("rejects a connection from another dialect before querying", async () => {
  const fake = connection({}, "sqlite")
  const catalog = await readCatalog(fake.connection, options())

  expect(fake.calls).toHaveLength(0)
  expect(catalog.diagnostics).toEqual([
    expect.objectContaining({
      code: "dialect-mismatch",
      severity: "error",
    }),
  ])
})

test("normalizes PostgreSQL complete object families and maps Snapshot v1", async () => {
  const rows: Record<string, readonly Row[]> = {
    [postgresServerQuery]: [
      {
        server_version_num: "160002",
        server_version: "16.0",
      },
    ],
    [postgresRelationsQuery]: [
      {
        oid: "10",
        namespace: "tenant",
        relname: "accounts",
        relkind: "p",
      },
      {
        oid: "11",
        namespace: "tenant",
        relname: "accounts_2024",
        relkind: "r",
        relispartition: true,
      },
      {
        oid: "30",
        namespace: "tenant",
        relname: "account_view",
        relkind: "v",
      },
      {
        oid: "31",
        namespace: "tenant",
        relname: "account_report",
        relkind: "m",
      },
      {
        oid: "40",
        namespace: "tenant",
        relname: "account_seq",
        relkind: "S",
      },
      {
        oid: "50",
        namespace: "tenant",
        relname: "remote_accounts",
        relkind: "f",
      },
      {
        oid: "60",
        namespace: "tenant",
        relname: "account_heap",
        relkind: "c",
      },
    ],
    [postgresViewsQuery]: [
      {
        oid: "30",
        namespace: "tenant",
        physical_name: "account_view",
        relkind: "v",
        definition: "SELECT id FROM accounts",
        check_option: "NONE",
      },
      {
        oid: "31",
        namespace: "tenant",
        physical_name: "account_report",
        relkind: "m",
        definition: "SELECT count(*) FROM accounts",
      },
    ],
    [postgresColumnsQuery]: [
      {
        table_oid: "10",
        ordinal_position: 1,
        physical_name: "id",
        nullable: false,
        native_type: "integer",
        attidentity: "a",
        attgenerated: "",
        default_expression: null,
      },
      {
        table_oid: "11",
        ordinal_position: 1,
        physical_name: "id",
        nullable: false,
        native_type: "integer",
        attidentity: "",
        attgenerated: "",
        default_expression: null,
      },
      {
        table_oid: "30",
        ordinal_position: 1,
        physical_name: "id",
        nullable: false,
        native_type: "integer",
        attidentity: "",
        attgenerated: "",
        default_expression: null,
      },
    ],
    [postgresIdentitiesQuery]: [
      {
        table_oid: "10",
        ordinal_position: 1,
        seqstart: "1",
        seqincrement: "1",
        seqmin: "1",
        seqmax: "2147483647",
        seqcache: "1",
        seqcycle: false,
        sequence_type: "integer",
      },
    ],
    [postgresConstraintsQuery]: [
      {
        oid: "101",
        table_oid: "10",
        physical_name: "accounts_pkey",
        contype: "p",
        conkey: [1],
        backing_index_oid: "201",
        condeferrable: false,
        condeferred: false,
        convalidated: true,
      },
    ],
    [postgresIndexesQuery]: [
      {
        index_oid: "201",
        table_oid: "10",
        physical_name: "accounts_pkey",
        indisunique: true,
        indnkeyatts: 1,
        indnatts: 1,
        method: "btree",
        position: 1,
        attnum: 1,
        indoption: 0,
        operator_class: "int4_ops",
        term_definition: "id",
      },
    ],
    [postgresSequencesQuery]: [
      {
        oid: "40",
        namespace: "tenant",
        physical_name: "account_seq",
        native_type: "bigint",
        seqstart: "1",
        seqincrement: "1",
        seqmin: "1",
        seqmax: "9223372036854775807",
        seqcache: "10",
        seqcycle: false,
        owned_table_oid: "10",
        owned_column_position: 1,
      },
    ],
    [postgresEnumsQuery]: [
      {
        oid: "300",
        namespace: "tenant",
        physical_name: "account_role",
        value_oid: "301",
        value: "member",
        ordinal_position: 1,
      },
      {
        oid: "300",
        namespace: "tenant",
        physical_name: "account_role",
        value_oid: "302",
        value: "owner",
        ordinal_position: 2,
      },
    ],
    [postgresDomainsQuery]: [
      {
        oid: "310",
        namespace: "tenant",
        physical_name: "account_id",
        native_type: "integer",
        nullable: false,
        default_expression: "1",
      },
    ],
    [postgresDomainConstraintsQuery]: [
      {
        oid: "311",
        domain_oid: "310",
        physical_name: "account_id_positive",
        definition: "CHECK (VALUE > 0)",
        condeferrable: false,
        condeferred: false,
        convalidated: true,
      },
    ],
    [postgresCollationsQuery]: [
      {
        oid: "400",
        namespace: "tenant",
        physical_name: "tenant_en",
        collprovider: "i",
        collcollate: "en-US",
        collctype: "en-US",
        colliculocale: "en-US",
        collisdeterministic: true,
        collversion: "153.14",
      },
    ],
    [postgresTriggersQuery]: [
      {
        oid: "500",
        table_oid: "10",
        namespace: "tenant",
        physical_name: "accounts_audit",
        trigger_type: 23,
        tgenabled: "O",
        condition: "(old.id IS DISTINCT FROM new.id)",
        definition:
          "CREATE TRIGGER accounts_audit BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION audit_accounts()",
      },
    ],
    [postgresRoutinesQuery]: [
      {
        oid: "600",
        namespace: "tenant",
        physical_name: "account_count",
        prokind: "f",
        return_type: "integer",
        language: "sql",
        definition:
          "CREATE FUNCTION account_count() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE SQL",
        identity_arguments: "",
        provolatile: "s",
        proparallel: "s",
        prosecdef: false,
      },
    ],
    [postgresRoutineParametersQuery]: [],
    [postgresPartitionsQuery]: [
      {
        partition_oid: "11",
        parent_oid: "10",
        namespace: "tenant",
        physical_name: "accounts_2024",
        partstrat: "r",
        key_attributes: "{1}",
        bound: "FOR VALUES FROM (1) TO (10)",
        relispartition: true,
        relkind: "r",
      },
    ],
    [postgresPoliciesQuery]: [
      {
        oid: "800",
        table_oid: "10",
        namespace: "tenant",
        physical_name: "tenant_accounts",
        polcmd: "r",
        polpermissive: true,
        roles: ["app"],
        using_expression: "(tenant_id = current_user_id())",
        check_expression: null,
      },
    ],
    [postgresExtensionsQuery]: [
      {
        oid: "700",
        namespace: "tenant",
        physical_name: "pgcrypto",
        extversion: "1.3",
        extrelocatable: false,
        config_relations: null,
        config_conditions: null,
      },
    ],
    [postgresMetadataQuery]: [
      {
        catalog_relation: "pg_class",
        object_oid: "10",
        object_subid: 0,
        object_kind: "table",
        object_name: "accounts",
        namespace: "tenant",
        description: "Account rows",
        owner: "app_owner",
      },
      {
        catalog_relation: "pg_class",
        object_oid: "10",
        object_subid: 1,
        object_kind: "column",
        object_name: "id",
        namespace: "tenant",
        description: "Account identifier",
        owner: "app_owner",
      },
      {
        catalog_relation: "pg_constraint",
        object_oid: "101",
        object_subid: 0,
        object_kind: "constraint",
        object_name: "accounts_pkey",
        namespace: "tenant",
        description: "Primary key",
        owner: "app_owner",
      },
      {
        catalog_relation: "pg_trigger",
        object_oid: "500",
        object_subid: 0,
        object_kind: "trigger",
        object_name: "accounts_audit",
        namespace: "tenant",
        description: "Audit changes",
        owner: "app_owner",
      },
      {
        catalog_relation: "pg_policy",
        object_oid: "800",
        object_subid: 0,
        object_kind: "policy",
        object_name: "tenant_accounts",
        namespace: "tenant",
        description: "Tenant boundary",
        owner: "app_owner",
      },
      {
        catalog_relation: "pg_extension",
        object_oid: "700",
        object_subid: 0,
        object_kind: "extension",
        object_name: "pgcrypto",
        namespace: "tenant",
        description: "Crypto helpers",
        owner: "app_owner",
      },
    ],
  }
  const fake = exactConnection(rows)
  const catalog = await readCatalog(fake.connection, options())

  expect((catalog.views ?? []).map((view) => view.kind)).toEqual(["view", "materialized-view"])
  expect(catalog.sequences?.[0]).toMatchObject({
    physicalName: "account_seq",
    start: {
      kind: "literal",
      value: 1,
    },
    ownedBy: {
      kind: "table",
      id: "accounts",
    },
  })
  expect(catalog.enums?.[0]?.values.map((value) => value.value)).toEqual(["member", "owner"])
  expect(catalog.domains?.[0]?.constraints?.[0]).toMatchObject({
    kind: "check",
  })
  expect(catalog.collations?.[0]).toMatchObject({
    provider: "i",
    locale: "en-US",
    deterministic: true,
  })
  expect(catalog.triggers?.[0]).toMatchObject({
    timing: "before",
    events: ["insert", "update"],
    orientation: "row",
  })
  expect(catalog.routines?.[0]).toMatchObject({
    routineKind: "function",
    volatility: "stable",
    parallel: "safe",
  })
  expect(catalog.partitions?.[0]).toMatchObject({
    parent: {
      kind: "table",
      id: "accounts",
    },
    strategy: "range",
  })
  expect(catalog.policies?.[0]).toMatchObject({
    table: {
      kind: "table",
      id: "accounts",
    },
    command: "select",
  })
  expect(catalog.extensionObjects?.[0]).toMatchObject({
    extensionName: "pgcrypto",
    extensionVersion: "1.3",
  })
  expect(catalog.comments).toHaveLength(6)
  expect(catalog.ownership).toHaveLength(6)
  expect(catalog.deferredObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: "foreign-table",
        physicalName: "remote_accounts",
      }),
    ]),
  )
  expect(catalog.opaqueObjects).toEqual(
    expect.arrayContaining([expect.objectContaining({ objectKind: "postgres-relation:c" })]),
  )

  const mapped = mapCatalogToCompleteSnapshot(catalog)

  expect(mapped.ok).toBe(true)
  if (!mapped.ok) {
    return
  }

  expect(mapped.snapshot.views).toHaveLength(2)
  expect(mapped.snapshot.sequences).toHaveLength(1)
  expect(mapped.snapshot.enums).toHaveLength(1)
  expect(mapped.snapshot.domains).toHaveLength(1)
  expect(mapped.snapshot.collations).toHaveLength(1)
  expect(mapped.snapshot.triggers).toHaveLength(1)
  expect(mapped.snapshot.routines).toHaveLength(1)
  expect(mapped.snapshot.partitions).toHaveLength(1)
  expect(mapped.snapshot.policies).toHaveLength(1)
  expect(mapped.snapshot.extensions).toHaveLength(1)
  expect(mapped.snapshot.comments).toHaveLength(6)
  expect(mapped.snapshot.ownership).toHaveLength(6)
})
