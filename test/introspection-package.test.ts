import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as root from 'qubu'
import * as core from 'qubu/core'
import * as introspection from 'qubu/introspection'
import * as schema from 'qubu/schema'
import * as snapshot from 'qubu/snapshot'
import buildConfig from '../tsdown.config.ts'

type PackageManifest = {
  exports: Record<string, string>
  publishConfig: { exports: Record<string, string> }
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageManifest

test('resolves introspection without adding it to existing entrypoints', () => {
  expect(introspection.readPostgresCatalog).toBeTypeOf('function')
  expect(introspection.readSqliteCatalog).toBeTypeOf('function')
  expect(introspection.readMysqlCatalog).toBeTypeOf('function')
  expect(introspection.mapCatalogToSnapshot).toBeTypeOf('function')

  expect(root).not.toHaveProperty('readPostgresCatalog')
  expect(root).not.toHaveProperty('mapCatalogToSnapshot')
  expect(root).not.toHaveProperty('createDialect')
  expect(root).not.toHaveProperty('customSource')
  expect(core.createDialect).toBeTypeOf('function')
  expect(core.fragment).toBeTypeOf('function')
  expect(schema.customSource).toBeTypeOf('function')
  expect(snapshot.createSchemaSnapshot).toBeTypeOf('function')
  expect(snapshot.decodeSchemaSnapshot).toBeTypeOf('function')
})

test('keeps source and publish exports aligned with the build entry', () => {
  expect(manifest.exports).toMatchObject({
    '.': './src/index.ts',
    './core': './src/core/index.ts',
    './schema': './src/schema/index.ts',
    './snapshot': './src/snapshot/index.ts',
    './introspection': './src/introspection/index.ts',
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    '.': './dist/index.mjs',
    './core': './dist/core.mjs',
    './schema': './dist/schema.mjs',
    './snapshot': './dist/snapshot.mjs',
    './introspection': './dist/introspection.mjs',
  })
  expect(buildConfig.entry).toMatchObject({
    core: 'src/core/index.ts',
    schema: 'src/schema/index.ts',
    introspection: 'src/introspection/index.ts',
  })
})
