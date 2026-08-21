import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as root from 'qubu'
import * as introspection from 'qubu/introspection'
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
  expect(snapshot.createSchemaSnapshot).toBeTypeOf('function')
  expect(snapshot.decodeSchemaSnapshot).toBeTypeOf('function')
})

test('keeps source and publish exports aligned with the build entry', () => {
  expect(manifest.exports).toMatchObject({
    '.': './src/index.ts',
    './snapshot': './src/snapshot/index.ts',
    './introspection': './src/introspection/index.ts',
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    '.': './dist/index.mjs',
    './snapshot': './dist/snapshot.mjs',
    './introspection': './dist/introspection.mjs',
  })
  expect(buildConfig.entry).toMatchObject({
    introspection: 'src/introspection/index.ts',
  })
})
