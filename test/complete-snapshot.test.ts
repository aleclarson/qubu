import { expect, test } from 'vitest'
import {
  createCompleteIntrospectionCatalog,
  mapCatalogToCompleteSnapshot,
  type CatalogColumn,
  type IntrospectionCatalog,
} from '../src/introspection/index.ts'
import {
  assertCompleteSchemaSnapshot,
  completeSchemaSnapshotDigest,
  decodeCompleteSchemaSnapshot,
  encodeCompleteSchemaSnapshot,
  type CompleteSchemaSnapshot,
} from '../src/snapshot/index.ts'

const capabilities = {
  generatedColumns: true,
  identityMetadata: true,
  checkConstraints: true,
  checkConstraintEnforcement: 'enforced' as const,
  expressionDecompilation: true,
  indexExpressions: true,
  indexPredicates: true,
  indexIncludedColumns: true,
  namespaces: true,
  visibility: 'complete' as const,
}

const expression = {
  kind: 'expression' as const,
  expressionKind: 'unsafe',
  sql: 'CURRENT_TIMESTAMP',
  dialect: 'postgresql',
}

function completeSnapshot(): CompleteSchemaSnapshot {
  return {
    format: 'qubu-schema',
    version: 2,
    dialect: { name: 'postgresql', version: 1 },
    namingPolicy: { name: 'introspected-physical', version: 1 },
    namespace: { kind: 'postgres-schema', name: 'public' },
    capabilities,
    tables: [
      {
        kind: 'table',
        id: 'accounts',
        physicalName: 'accounts',
        physicalReference: {
          kind: 'table',
          namespace: 'public',
          name: 'accounts',
        },
        columns: [
          {
            kind: 'column',
            id: 'id',
            physicalName: 'id',
            ordinalPosition: 1,
            nullable: false,
            hasDefault: false,
            generated: false,
            storage: { kind: 'native', dialect: 'postgresql', type: 'integer' },
          },
        ],
        constraints: [
          {
            kind: 'primary-key',
            id: 'accounts_pkey',
            physicalName: 'accounts_pkey',
            columns: ['id'],
          },
        ],
        indexes: [],
      },
    ],
    views: [
      {
        kind: 'view',
        id: 'account_view',
        physicalName: 'account_view',
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
        kind: 'comment',
        id: 'accounts-comment',
        physicalName: 'accounts-comment',
        object: { kind: 'table', id: 'accounts' },
        text: 'Accounts',
      },
    ],
    ownership: [],
  }
}

test('encodes and decodes complete immutable object families', () => {
  const snapshot = assertCompleteSchemaSnapshot(completeSnapshot())
  const encoded = encodeCompleteSchemaSnapshot(snapshot)
  const decoded = decodeCompleteSchemaSnapshot(encoded)

  expect(decoded.ok).toBe(true)
  expect(snapshot.version).toBe(2)
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(snapshot.tables[0])).toBe(true)
  expect(completeSchemaSnapshotDigest(encoded)).toBe(
    completeSchemaSnapshotDigest(snapshot)
  )
  if (decoded.ok)
    expect(encodeCompleteSchemaSnapshot(decoded.value)).toBe(encoded)
})

test('rejects unknown fields, future versions, and broken references', () => {
  const unknown = JSON.parse(
    encodeCompleteSchemaSnapshot(completeSnapshot())
  ) as Record<string, unknown>
  unknown.unexpected = true
  const unknownResult = decodeCompleteSchemaSnapshot(unknown)
  expect(unknownResult.ok).toBe(false)
  if (!unknownResult.ok)
    expect(unknownResult.diagnostics[0]?.code).toBe('unknown-field')

  const future = JSON.parse(
    encodeCompleteSchemaSnapshot(completeSnapshot())
  ) as Record<string, unknown>
  future.version = 3
  const futureResult = decodeCompleteSchemaSnapshot(future)
  expect(futureResult.ok).toBe(false)
  if (!futureResult.ok)
    expect(futureResult.diagnostics[0]?.code).toBe('future-version')

  const malformed = JSON.parse(
    encodeCompleteSchemaSnapshot(completeSnapshot())
  ) as {
    comments: Array<{ object: { id: string } }>
  }
  malformed.comments[0]!.object.id = 'missing'
  const malformedResult = decodeCompleteSchemaSnapshot(malformed)
  expect(malformedResult.ok).toBe(false)
  if (!malformedResult.ok)
    expect(
      malformedResult.diagnostics.some(
        issue => issue.code === 'invalid-cross-reference'
      )
    ).toBe(true)
})

test('maps normalized complete catalogs without turning deferred objects into tables', () => {
  const column: CatalogColumn = {
    kind: 'column',
    id: 'id',
    identitySource: 'physical-name',
    physicalName: 'id',
    ordinalPosition: 1,
    nullable: false,
    storage: { nativeType: 'integer' },
  }
  const catalog: IntrospectionCatalog = {
    dialect: 'postgresql',
    server: {
      product: 'PostgreSQL',
      rawVersion: '16',
      capabilities,
    },
    namespace: { kind: 'postgres-schema', name: 'public' },
    tables: [
      {
        kind: 'table',
        id: 'accounts',
        identitySource: 'physical-name',
        physicalName: 'accounts',
        columns: [column],
        constraints: [],
        indexes: [],
      },
    ],
    views: [
      {
        kind: 'view',
        id: 'account_view',
        identitySource: 'physical-name',
        physicalName: 'account_view',
        columns: [],
        definition: {
          kind: 'sql',
          dialect: 'postgresql',
          text: 'SELECT 1',
          provenance: { kind: 'catalog', dialect: 'postgresql' },
        },
      },
    ],
    deferredObjects: [
      { kind: 'deferred-object', objectKind: 'trigger', physicalName: 'audit' },
    ],
    diagnostics: [],
  }
  const frozen = createCompleteIntrospectionCatalog(catalog)
  expect(Object.isFrozen(frozen)).toBe(true)
  expect(Object.isFrozen(frozen.tables[0])).toBe(true)
  const result = mapCatalogToCompleteSnapshot(catalog)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.snapshot.tables.map(table => table.id)).toEqual(['accounts'])
  expect(result.snapshot.views.map(view => view.id)).toEqual(['account_view'])
  expect(result.snapshot.deferredObjects[0]).toMatchObject({
    objectKind: 'trigger',
    physicalName: 'audit',
  })
})

test('retains typed catalog unknown fields as opaque snapshot records', () => {
  const column: CatalogColumn = {
    kind: 'column',
    id: 'id',
    identitySource: 'physical-name',
    physicalName: 'id',
    ordinalPosition: 1,
    nullable: false,
    storage: { nativeType: 'integer' },
    unknownFields: [
      {
        name: 'compression',
        value: 'lz4',
        provenance: { kind: 'catalog', dialect: 'postgresql' },
      },
    ],
  }
  const catalog: IntrospectionCatalog = {
    dialect: 'postgresql',
    server: { product: 'PostgreSQL', rawVersion: '16', capabilities },
    namespace: { kind: 'postgres-schema', name: 'public' },
    tables: [
      {
        kind: 'table',
        id: 'accounts',
        identitySource: 'physical-name',
        physicalName: 'accounts',
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
  if (!result.ok) return
  expect(result.snapshot.opaqueObjects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: 'unknown-field',
        data: expect.objectContaining({ field: 'compression', value: 'lz4' }),
      }),
    ])
  )
})

test('reports non-canonical random object ordering', () => {
  const first = completeSnapshot()
  const secondTable = {
    ...first.tables[0]!,
    id: 'users',
    physicalName: 'users',
    columns: [],
    constraints: [],
  }
  const reordered = {
    ...first,
    tables: [secondTable, first.tables[0]!],
  }
  const result = decodeCompleteSchemaSnapshot(reordered)
  expect(result.ok).toBe(false)
  if (!result.ok)
    expect(
      result.diagnostics.some(issue => issue.code === 'non-canonical')
    ).toBe(true)
})

test('validates every complete object family and typed extension boundary', () => {
  const base = completeSnapshot()
  const expanded: CompleteSchemaSnapshot = {
    ...base,
    views: [
      {
        ...base.views[0]!,
        dependencies: [{ kind: 'table', id: 'accounts' }],
      },
    ],
    sequences: [
      {
        kind: 'sequence',
        id: 'accounts_seq',
        physicalName: 'accounts_seq',
        start: { kind: 'literal', value: { kind: 'number', value: '1' } },
        increment: { kind: 'literal', value: { kind: 'number', value: '1' } },
        ownedBy: { kind: 'table', id: 'accounts' },
      },
    ],
    enums: [
      {
        kind: 'enum',
        id: 'account_role',
        physicalName: 'account_role',
        values: [
          { value: 'member', ordinalPosition: 1 },
          { value: 'owner', ordinalPosition: 2 },
        ],
      },
    ],
    domains: [
      {
        kind: 'domain',
        id: 'account_id',
        physicalName: 'account_id',
        storage: { kind: 'native', dialect: 'postgresql', type: 'integer' },
        constraints: [
          {
            kind: 'check',
            id: 'account_id_positive',
            physicalName: 'account_id_positive',
            expression,
          },
        ],
      },
    ],
    collations: [
      {
        kind: 'collation',
        id: 'en_us',
        physicalName: 'en_us',
        provider: 'libc',
        locale: 'en_US',
        deterministic: true,
      },
    ],
    triggers: [
      {
        kind: 'trigger',
        id: 'accounts_audit',
        physicalName: 'accounts_audit',
        table: { kind: 'table', id: 'accounts' },
        timing: 'after',
        events: ['insert'],
        body: expression,
      },
    ],
    routines: [
      {
        kind: 'routine',
        id: 'account_count',
        physicalName: 'account_count',
        routineKind: 'function',
        parameters: [],
        returnType: { kind: 'native', dialect: 'postgresql', type: 'integer' },
        body: expression,
      },
    ],
    partitions: [
      {
        kind: 'partition',
        id: 'accounts_default',
        physicalName: 'accounts_default',
        parent: { kind: 'table', id: 'accounts' },
        strategy: 'range',
        bound: expression,
      },
    ],
    policies: [
      {
        kind: 'policy',
        id: 'accounts_policy',
        physicalName: 'accounts_policy',
        table: { kind: 'table', id: 'accounts' },
        command: 'select',
        using: expression,
      },
    ],
    extensions: [
      {
        kind: 'extension',
        id: 'postgis',
        physicalName: 'postgis',
        extensionName: 'postgis',
        data: { version: '3.4' },
      },
    ],
    deferredObjects: [
      {
        kind: 'deferred-object',
        id: 'foreign_table',
        objectKind: 'foreign-table',
        physicalName: 'foreign_table',
      },
    ],
    opaqueObjects: [
      {
        kind: 'opaque-object',
        id: 'custom_object',
        objectKind: 'custom-object',
        physicalName: 'custom_object',
        data: { observed: true },
        sql: expression,
      },
    ],
    ownership: [
      {
        kind: 'ownership',
        id: 'accounts-owner',
        physicalName: 'accounts-owner',
        object: { kind: 'table', id: 'accounts' },
        owner: 'app',
      },
    ],
  }
  expect(() => assertCompleteSchemaSnapshot(expanded)).not.toThrow()
})
