import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as drizzle from '@qubu/drizzle'
import buildConfig from '../tsdown.config.ts'

type PackageManifest = {
  exports: Record<string, string | { types: string }>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  publishConfig: {
    exports: Record<string, string | { types: string; import?: string }>
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageManifest
const rootManifest = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
) as PackageManifest

const sharedSource = ['index', 'errors', 'runtime', 'types']
  .map(file =>
    readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8')
  )
  .join('\n')

const dialectSources = [
  {
    dialect: 'mysql',
    core: 'mysql',
    source: readFileSync(new URL('../src/mysql.ts', import.meta.url), 'utf8'),
  },
  {
    dialect: 'postgres',
    core: 'pg',
    source: readFileSync(
      new URL('../src/postgres.ts', import.meta.url),
      'utf8'
    ),
  },
  {
    dialect: 'sqlite',
    core: 'sqlite',
    source: readFileSync(new URL('../src/sqlite.ts', import.meta.url), 'utf8'),
  },
]

test('publishes one build entry for each Drizzle dialect', () => {
  expect(manifest.exports).toMatchObject({
    '.': './src/index.ts',
    './mysql': './src/mysql.ts',
    './postgres': './src/postgres.ts',
    './sqlite': './src/sqlite.ts',
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    '.': {
      types: './dist/index.d.mts',
      import: './dist/index.mjs',
    },
    './mysql': {
      types: './dist/mysql.d.mts',
      import: './dist/mysql.mjs',
    },
    './postgres': {
      types: './dist/postgres.d.mts',
      import: './dist/postgres.mjs',
    },
    './sqlite': {
      types: './dist/sqlite.d.mts',
      import: './dist/sqlite.mjs',
    },
  })
  expect(buildConfig.entry).toMatchObject({
    index: 'src/index.ts',
    mysql: 'src/mysql.ts',
    postgres: 'src/postgres.ts',
    sqlite: 'src/sqlite.ts',
  })
})

test('keeps Drizzle core imports isolated by dialect', () => {
  expect(drizzle).toHaveProperty('DrizzleSchemaConversionError')
  expect(drizzle).not.toHaveProperty('toDrizzleSchema')
  expect(sharedSource).not.toMatch(/drizzle-orm\/(?:pg|mysql|sqlite)-core/)

  for (const { dialect, core, source } of dialectSources) {
    const coreImports = [...source.matchAll(/drizzle-orm\/(\w+)-core/g)].map(
      match => match[1]
    )
    expect(coreImports, dialect).toEqual([core])
  }
})

test('keeps Drizzle ownership outside the root Qubu package', () => {
  expect(rootManifest.exports).not.toHaveProperty('./drizzle')
  expect(rootManifest.exports).not.toHaveProperty('./drizzle/mysql')
  expect(rootManifest.exports).not.toHaveProperty('./drizzle/postgres')
  expect(rootManifest.exports).not.toHaveProperty('./drizzle/sqlite')
  expect(rootManifest.devDependencies ?? {}).not.toHaveProperty('drizzle-orm')
  expect(rootManifest.peerDependencies ?? {}).not.toHaveProperty('drizzle-orm')
})
