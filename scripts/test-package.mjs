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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function optionalPeerInstallSpecs(manifest) {
  return Object.entries(manifest.peerDependenciesMeta ?? {})
    .filter(([, metadata]) => metadata.optional)
    .map(([name]) => {
      const version = manifest.devDependencies?.[name]
      assert.equal(
        typeof version,
        'string',
        `optional peer ${name} must have a tested devDependency version`
      )
      return `${name}@${version}`
    })
}

function assertFileTarget(packageRoot, target, subpath, condition) {
  assert.match(
    target,
    /^\.\//,
    `${subpath} ${condition} target must start with "./"`
  )
  const resolvedTarget = resolve(packageRoot, target)
  const relativeTarget = relative(packageRoot, resolvedTarget)
  assert(
    relativeTarget &&
      !relativeTarget.startsWith('..') &&
      !isAbsolute(relativeTarget),
    `${subpath} ${condition} target must stay inside the package`
  )
  assert(
    statSync(resolvedTarget).isFile(),
    `${subpath} ${condition} target is not a file: ${target}`
  )
}

function validateExports(packageRoot, exports, sourceExportKeys) {
  assert(
    exports && typeof exports === 'object' && !Array.isArray(exports),
    'package exports must be an object'
  )

  const exportKeys = Object.keys(exports)
  if (sourceExportKeys) {
    assert.deepEqual(
      exportKeys.toSorted(),
      sourceExportKeys.toSorted(),
      'source and published export keys must match'
    )
  }

  const runtimeSpecifiers = []
  const typeOnlySpecifiers = []

  for (const [subpath, descriptor] of Object.entries(exports)) {
    assert(
      subpath === '.' || subpath.startsWith('./'),
      `invalid package export key: ${subpath}`
    )

    if (subpath === './package.json') {
      assert.equal(descriptor, './package.json')
      assertFileTarget(packageRoot, descriptor, subpath, 'default')
      continue
    }

    assert(
      descriptor &&
        typeof descriptor === 'object' &&
        !Array.isArray(descriptor),
      `${subpath} must declare explicit type and runtime conditions`
    )

    const conditions = Object.keys(descriptor)
    assert.equal(
      typeof descriptor.types,
      'string',
      `${subpath} must declare a types target`
    )
    assert.match(
      descriptor.types,
      /^\.\/dist\/.+\.d\.[cm]?ts$/,
      `${subpath} types target must be a declaration in dist`
    )
    assertFileTarget(packageRoot, descriptor.types, subpath, 'types')

    const specifier = subpath === '.' ? 'qubu' : `qubu/${subpath.slice(2)}`
    if ('import' in descriptor) {
      assert.deepEqual(
        conditions,
        ['types', 'import'],
        `${subpath} conditions must put types before import`
      )
      assert.equal(
        typeof descriptor.import,
        'string',
        `${subpath} must declare an import target`
      )
      assert.match(
        descriptor.import,
        /^\.\/dist\/.+\.mjs$/,
        `${subpath} import target must be an ESM artifact in dist`
      )
      assertFileTarget(packageRoot, descriptor.import, subpath, 'import')
      runtimeSpecifiers.push(specifier)
    } else {
      assert.deepEqual(
        conditions,
        ['types'],
        `${subpath} must be type-only or declare an import target`
      )
      typeOnlySpecifiers.push(specifier)
    }
  }

  assert(
    runtimeSpecifiers.length > 0,
    'package must expose runtime entrypoints'
  )
  assert(
    typeOnlySpecifiers.length > 0,
    'package must expose a type-only entrypoint'
  )

  return { runtimeSpecifiers, typeOnlySpecifiers }
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  })
}

function validateBuiltPackage() {
  const manifest = readJson(join(repositoryRoot, 'package.json'))
  const publishedExports = manifest.publishConfig?.exports
  const { runtimeSpecifiers, typeOnlySpecifiers } = validateExports(
    repositoryRoot,
    publishedExports,
    Object.keys(manifest.exports)
  )
  console.log(
    `Validated ${runtimeSpecifiers.length} runtime and ${runtimeSpecifiers.length + typeOnlySpecifiers.length} type entrypoints in dist.`
  )
}

function createTypeSmoke(consumerRoot, runtimeSpecifiers, typeOnlySpecifiers) {
  const runtimeImports = runtimeSpecifiers
    .map(
      (specifier, index) =>
        `import * as entry${index} from ${JSON.stringify(specifier)}`
    )
    .join('\n')
  const typeOnlyImports = typeOnlySpecifiers
    .map(specifier => `import ${JSON.stringify(specifier)}`)
    .join('\n')
  const entries = runtimeSpecifiers
    .map((_, index) => `entry${index}`)
    .join(', ')

  writeFileSync(
    join(consumerRoot, 'package-smoke.ts'),
    `${runtimeImports}
${typeOnlyImports}
import manifest from 'qubu/package.json' with { type: 'json' }

const entries: readonly object[] = [${entries}]
const packageName: string = manifest.name
const ambientSelect: typeof select = select
void [entries, packageName, ambientSelect]
`
  )
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ESNext',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          resolveJsonModule: true,
          noEmit: true,
          noUnusedLocals: true,
          skipLibCheck: true,
          types: typeOnlySpecifiers,
        },
        files: ['./package-smoke.ts'],
      },
      null,
      2
    )}\n`
  )
}

function createRuntimeSmoke(consumerRoot, runtimeSpecifiers) {
  writeFileSync(
    join(consumerRoot, 'package-smoke.mjs'),
    `const specifiers = ${JSON.stringify(runtimeSpecifiers)}

for (const specifier of specifiers) {
  const entrypoint = await import(specifier)
  if (Reflect.ownKeys(entrypoint).length === 0) {
    throw new Error(\`\${specifier} has no runtime exports\`)
  }
}

const manifest = (
  await import('qubu/package.json', { with: { type: 'json' } })
).default
if (manifest.name !== 'qubu') {
  throw new Error('qubu/package.json did not resolve to the packed package')
}
`
  )
}

function testPackedPackage(runtimes) {
  const repositoryManifest = readJson(join(repositoryRoot, 'package.json'))
  const optionalPeers = optionalPeerInstallSpecs(repositoryManifest)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'qubu-package-'))
  try {
    const tarball = join(temporaryRoot, 'qubu.tgz')
    run(packageManager, ['pack', '--out', tarball], repositoryRoot)

    writeFileSync(
      join(temporaryRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'qubu-package-smoke',
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
        '--dry-run=false',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarball,
        ...optionalPeers,
      ],
      temporaryRoot
    )

    const installedRoot = join(temporaryRoot, 'node_modules', 'qubu')
    const manifest = readJson(join(installedRoot, 'package.json'))
    const { runtimeSpecifiers, typeOnlySpecifiers } = validateExports(
      installedRoot,
      manifest.exports
    )

    createTypeSmoke(temporaryRoot, runtimeSpecifiers, typeOnlySpecifiers)
    createRuntimeSmoke(temporaryRoot, runtimeSpecifiers)

    run(
      process.execPath,
      [
        join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '--project',
        join(temporaryRoot, 'tsconfig.json'),
      ],
      temporaryRoot
    )
    console.log(
      `TypeScript resolved ${runtimeSpecifiers.length + typeOnlySpecifiers.length} packed type entrypoints.`
    )

    const smokeFile = join(temporaryRoot, 'package-smoke.mjs')
    if (runtimes.includes('node')) {
      run(process.execPath, [smokeFile], temporaryRoot)
      console.log(
        `Node loaded ${runtimeSpecifiers.length} packed runtime entrypoints.`
      )
    }
    if (runtimes.includes('bun')) {
      run('bun', [smokeFile], temporaryRoot)
      console.log(
        `Bun loaded ${runtimeSpecifiers.length} packed runtime entrypoints.`
      )
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

const checkBuilt = process.argv.includes('--check-built')
const runtimeOption = process.argv.find(argument =>
  argument.startsWith('--runtime=')
)
const runtime = runtimeOption?.slice('--runtime='.length)
assert(
  runtime === undefined || runtime === 'node' || runtime === 'bun',
  '--runtime must be "node" or "bun"'
)

if (checkBuilt) validateBuiltPackage()
else testPackedPackage(runtime ? [runtime] : ['node', 'bun'])
