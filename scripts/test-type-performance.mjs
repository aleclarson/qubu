import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
const compilerPath = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc")
const compilerPackagePath = join(repositoryRoot, "node_modules", "typescript", "package.json")
const benchmarkRoot = join(repositoryRoot, "benchmarks", "typescript")
const configPath = join(benchmarkRoot, "tsconfig.json")
const thresholdsPath = join(benchmarkRoot, "thresholds.json")
const builtTypesPath = join(repositoryRoot, "dist", "index.d.mts")

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  return result
}

function parseIntegerDiagnostic(output, label) {
  const match = output.match(new RegExp(`^${label}:\\s+([0-9]+)`, "m"))

  assert(match, `TypeScript did not report ${label}`)
  return Number(match[1])
}

function parseInformativeDiagnostic(output, label) {
  const match = output.match(new RegExp(`^${label}:\\s+([^\\r\\n]+)`, "m"))

  assert(match, `TypeScript did not report ${label}`)
  return match[1].trim()
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value)
}

const checkBuilt = process.argv.includes("--check-built")
const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--" && argument !== "--check-built")

assert.equal(unknownArguments.length, 0, `Unknown argument: ${unknownArguments.join(", ")}`)

if (!checkBuilt) {
  const build = run(packageManager, ["run", "build"], { stdio: "inherit" })

  if (build.status !== 0) {
    process.exit(build.status ?? 1)
  }
}

assert(statSync(builtTypesPath).isFile(), "Build dist before checking types")

const thresholds = readJson(thresholdsPath)
const compilerPackage = readJson(compilerPackagePath)

assert.equal(
  compilerPackage.version,
  thresholds.typescriptVersion,
  `TypeScript ${compilerPackage.version} has no reviewed performance baseline; expected ${thresholds.typescriptVersion}`,
)

const compiler = run(process.execPath, [
  compilerPath,
  "--project",
  configPath,
  "--extendedDiagnostics",
  "--pretty",
  "false",
])
const compilerOutput = `${compiler.stdout}${compiler.stderr}`

if (compiler.status !== 0) {
  process.stderr.write(compilerOutput)
  process.exit(compiler.status ?? 1)
}

const failures = []

console.log(`TypeScript ${compilerPackage.version} compiler performance`)

for (const [label, threshold] of Object.entries(thresholds.metrics)) {
  assert(
    Number.isInteger(threshold.baseline) && threshold.baseline > 0,
    `${label} baseline must be a positive integer`,
  )
  assert(
    Number.isInteger(threshold.limit) && threshold.limit >= threshold.baseline,
    `${label} limit must be an integer at or above its baseline`,
  )

  const actual = parseIntegerDiagnostic(compilerOutput, label)
  const change = ((actual - threshold.baseline) / threshold.baseline) * 100
  const changeLabel = `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`

  console.log(
    `  ${label}: ${formatCount(actual)} (${changeLabel} from ${formatCount(threshold.baseline)} baseline; limit ${formatCount(threshold.limit)})`,
  )

  if (actual > threshold.limit) {
    failures.push(`${label} ${formatCount(actual)} exceeds ${formatCount(threshold.limit)}`)
  }
}

for (const label of ["Memory used", "Check time", "Total time"]) {
  console.log(`  ${label}: ${parseInformativeDiagnostic(compilerOutput, label)} (informative)`)
}

if (failures.length > 0) {
  console.error("\nTypeScript compiler-performance limit exceeded:")
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }

  process.exitCode = 1
}
