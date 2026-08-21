import { expectTypeOf } from 'vitest'
import type {
  CatalogConnection,
  CatalogIdentityHint,
  CatalogIntrospector,
  CatalogQuery,
  CatalogQueryRow,
  CatalogSqlExpression,
  IntrospectionDiagnosticCode,
  IntrospectionOptions,
  IntrospectionResult,
} from '../src/introspection/index.ts'
import type { SchemaSnapshot } from '../src/snapshot/index.ts'

const query: CatalogQuery = {
  text: 'SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?',
  parameters: ['app'],
}

const connection: CatalogConnection = {
  dialect: 'mysql',
  async query<TRow extends CatalogQueryRow = CatalogQueryRow>(
    _statement: CatalogQuery,
    _options?: { readonly signal?: AbortSignal }
  ): Promise<readonly TRow[]> {
    return [] as readonly TRow[]
  },
}

const rows = connection.query<{ readonly schemaName: string }>(query)
expectTypeOf(rows).toEqualTypeOf<
  Promise<readonly { readonly schemaName: string }[]>
>()

const expression: CatalogSqlExpression = {
  kind: 'sql',
  dialect: 'postgresql',
  text: 'CURRENT_TIMESTAMP',
  provenance: {
    kind: 'decompiler',
    dialect: 'postgresql',
    path: ['columns', 0, 'default'],
  },
}

expectTypeOf(expression.text).toBeString()
expectTypeOf(expression.provenance.kind).toEqualTypeOf<
  'catalog' | 'decompiler' | 'create-sql'
>()

// @ts-expect-error Catalog SQL is immutable opaque data.
expression.text = 'SELECT 1'

const identityHint: CatalogIdentityHint = {
  kind: 'column',
  logicalId: 'createdAt',
  physicalName: 'created_at',
  tablePhysicalName: 'accounts',
}

const previousSnapshot = {
  format: 'qubu-schema',
  version: 1,
  dialect: { name: 'mysql', version: 1 },
  namingPolicy: { name: 'introspected-physical', version: 1 },
  namespace: 'app',
  tables: [],
} satisfies SchemaSnapshot

const options: IntrospectionOptions = {
  namespace: 'app',
  previousSnapshot,
  identityHints: [identityHint],
  mode: 'lossy',
}

expectTypeOf(options.mode).toEqualTypeOf<'strict' | 'lossy' | undefined>()

declare const result: IntrospectionResult
if (result.ok) {
  expectTypeOf(result.snapshot).toEqualTypeOf<SchemaSnapshot>()
  expectTypeOf(result.catalog).toMatchTypeOf<object>()
  expectTypeOf(result.lossy).toBeBoolean()
} else {
  expectTypeOf(result.catalog).toEqualTypeOf<
    import('../src/introspection/index.ts').IntrospectionCatalog | undefined
  >()
  expectTypeOf(result.lossy).toEqualTypeOf<false>()
  // @ts-expect-error Failed introspection has no snapshot.
  result.snapshot
}

const introspector: CatalogIntrospector = async (_connection, _options) => {
  throw new Error('contract-only test')
}
expectTypeOf(introspector).toMatchTypeOf<CatalogIntrospector>()

expectTypeOf<IntrospectionDiagnosticCode>().toEqualTypeOf<
  | 'connection-failed'
  | 'query-failed'
  | 'permission-denied'
  | 'unsupported-product'
  | 'unsupported-server'
  | 'unsupported-feature'
  | 'invalid-catalog-row'
  | 'missing-catalog-row'
  | 'expression-parse-failed'
  | 'unresolved-reference'
  | 'ambiguous-identity'
  | 'unmodeled-object'
  | 'lossy-mapping'
  | 'dialect-mismatch'
  | 'partial-result'
>()
