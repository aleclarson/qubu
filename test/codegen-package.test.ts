import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import * as codegen from 'qubu/codegen'
import * as root from 'qubu'
import buildConfig from '../tsdown.config.ts'

type PackageManifest = {
  exports: Record<string, string>
  publishConfig: {
    exports: Record<string, string | { types: string; import: string }>
  }
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageManifest

test('resolves codegen without adding it to the root entrypoint', () => {
  expect(codegen.generateSchemaSource).toBeTypeOf('function')
  expect(root).not.toHaveProperty('generateSchemaSource')
})

test('aligns codegen source, publish, and build exports', () => {
  expect(manifest.exports['./codegen']).toBe('./src/codegen/index.ts')
  expect(manifest.publishConfig.exports['./codegen']).toEqual({
    types: './dist/codegen.d.mts',
    import: './dist/codegen.mjs',
  })
  expect(buildConfig.entry).toMatchObject({
    codegen: 'src/codegen/index.ts',
  })
})
