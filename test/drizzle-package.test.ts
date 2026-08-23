import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as drizzle from 'qubu/drizzle'
import buildConfig from '../tsdown.config.ts'

type PackageManifest = {
  exports: Record<string, string | { types: string }>
  publishConfig: {
    exports: Record<string, string | { types: string; import?: string }>
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageManifest

const sharedSource = ['index', 'errors', 'runtime', 'types']
  .map(file =>
    readFileSync(new URL(`../src/drizzle/${file}.ts`, import.meta.url), 'utf8')
  )
  .join('\n')

const dialectSources = [
  {
    dialect: 'mysql',
    core: 'mysql',
    source: readFileSync(
      new URL('../src/drizzle/mysql.ts', import.meta.url),
      'utf8'
    ),
  },
  {
    dialect: 'postgres',
    core: 'pg',
    source: readFileSync(
      new URL('../src/drizzle/postgres.ts', import.meta.url),
      'utf8'
    ),
  },
  {
    dialect: 'sqlite',
    core: 'sqlite',
    source: readFileSync(
      new URL('../src/drizzle/sqlite.ts', import.meta.url),
      'utf8'
    ),
  },
]

test('publishes one build entry for each Drizzle dialect', () => {
  expect(manifest.exports).toMatchObject({
    './drizzle': './src/drizzle/index.ts',
    './drizzle/mysql': './src/drizzle/mysql.ts',
    './drizzle/postgres': './src/drizzle/postgres.ts',
    './drizzle/sqlite': './src/drizzle/sqlite.ts',
  })
  expect(manifest.publishConfig.exports).toMatchObject({
    './drizzle': {
      types: './dist/drizzle.d.mts',
      import: './dist/drizzle.mjs',
    },
    './drizzle/mysql': {
      types: './dist/drizzle-mysql.d.mts',
      import: './dist/drizzle-mysql.mjs',
    },
    './drizzle/postgres': {
      types: './dist/drizzle-postgres.d.mts',
      import: './dist/drizzle-postgres.mjs',
    },
    './drizzle/sqlite': {
      types: './dist/drizzle-sqlite.d.mts',
      import: './dist/drizzle-sqlite.mjs',
    },
  })
  expect(buildConfig.entry).toMatchObject({
    drizzle: 'src/drizzle/index.ts',
    'drizzle-mysql': 'src/drizzle/mysql.ts',
    'drizzle-postgres': 'src/drizzle/postgres.ts',
    'drizzle-sqlite': 'src/drizzle/sqlite.ts',
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
