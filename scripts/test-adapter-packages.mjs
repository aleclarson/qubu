import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  adapterDirectories,
  packageRoot,
  readManifest,
  repositoryRoot,
} from './workspace-packages.mjs'

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  })
}

function installSpecs(manifests) {
  const specs = new Set()
  for (const manifest of manifests) {
    for (const [name, version] of Object.entries(
      manifest.devDependencies ?? {}
    )) {
      if (name !== 'qubu' && !version.startsWith('workspace:')) {
        specs.add(`${name}@${version}`)
      }
    }
  }
  return [...specs].toSorted()
}

function validateInstalledAdapter(consumerRoot, name) {
  const root = join(consumerRoot, 'node_modules', ...name.split('/'))
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  assert.equal(manifest.repository?.url, 'https://github.com/aleclarson/qubu')
  assert.equal(manifest.types, './dist/index.d.mts')
  assert.equal(manifest.exports?.['.'], './dist/index.mjs')
  assert.equal(manifest.exports?.['./package.json'], './package.json')
  assert(statSync(join(root, 'dist/index.mjs')).isFile())
  assert(statSync(join(root, 'dist/index.d.mts')).isFile())
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'qubu-adapters-'))
try {
  const rootTarball = join(temporaryRoot, 'qubu.tgz')
  run(packageManager, ['pack', '--out', rootTarball], repositoryRoot)

  const manifests = adapterDirectories.map(readManifest)
  const adapterTarballs = adapterDirectories.map((directory, index) => {
    const tarball = join(temporaryRoot, `adapter-${index}.tgz`)
    run(packageManager, ['pack', '--out', tarball], packageRoot(directory))
    return tarball
  })

  writeFileSync(
    join(temporaryRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'qubu-adapter-package-smoke',
        private: true,
        type: 'module',
      },
      null,
      2
    )}\n`
  )
  run(
    npm,
    [
      'install',
      '--prefix',
      temporaryRoot,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      rootTarball,
      ...adapterTarballs,
      ...installSpecs(manifests),
    ],
    temporaryRoot
  )

  for (const manifest of manifests) {
    validateInstalledAdapter(temporaryRoot, manifest.name)
  }

  const imports = manifests
    .map(
      (manifest, index) =>
        `import * as adapter${index} from ${JSON.stringify(manifest.name)}`
    )
    .join('\n')
  const entries = manifests.map((_, index) => `adapter${index}`).join(', ')
  writeFileSync(
    join(temporaryRoot, 'package-smoke.ts'),
    `${imports}\n\nconst adapters: readonly object[] = [${entries}]\nvoid adapters\n`
  )
  writeFileSync(
    join(temporaryRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ESNext',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
        },
        files: ['./package-smoke.ts'],
      },
      null,
      2
    )}\n`
  )
  run(
    process.execPath,
    [
      join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--project',
      join(temporaryRoot, 'tsconfig.json'),
    ],
    temporaryRoot
  )

  writeFileSync(
    join(temporaryRoot, 'package-smoke.mjs'),
    `const packageNames = ${JSON.stringify(manifests.map(({ name }) => name))}\n\nfor (const name of packageNames) {\n  const entry = await import(name)\n  if (Reflect.ownKeys(entry).length === 0) throw new Error(\`${'${name}'} has no runtime exports\`)\n}\n`
  )
  run(
    process.execPath,
    [join(temporaryRoot, 'package-smoke.mjs')],
    temporaryRoot
  )
  console.log(
    `Validated ${manifests.length} packed adapter packages in Node and TypeScript.`
  )
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
