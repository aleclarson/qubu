import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import {
  array,
  command,
  flag,
  multioption,
  oneOf,
  option,
  optional,
  positional,
  runSafely,
  string,
  subcommands,
} from "@alloc/cmd-ts"
import {
  compileMigrationProgram,
  sealExecutableArtifact,
  type MigrationArtifact,
  type OperationApproval,
} from "@qubu/migrate/artifact"
import { createBaseline, type BaselineConfirmation } from "@qubu/migrate/baseline"
import { planSchemaBootstrap } from "@qubu/migrate/bootstrap"
import {
  executeMigrations,
  MigrationExecutionError,
  reconcileAttempt,
} from "@qubu/migrate/executor"
import { createMigrationPlan } from "@qubu/migrate/plan"
import { verifyArtifactChain } from "@qubu/migrate/repository"
import { readMigrationStatus } from "@qubu/migrate/status"
import { diffSnapshots } from "qubu/diff"
import type { SchemaDialect, SchemaSnapshot } from "qubu/snapshot"
import { mysqlSchemaDialect } from "qubu/snapshot/mysql"
import { postgresSchemaDialect } from "qubu/snapshot/postgres"
import { sqliteSchemaDialect } from "qubu/snapshot/sqlite"

import { resolveAdapter, resolveConfigSnapshot, type QubuCliConfig } from "./config.ts"
import { FileArtifactRepository } from "./repository.ts"

export const cliExitCodes = Object.freeze({
  success: 0,
  usage: 2,
  validation: 3,
  policy: 4,
  drift: 5,
  recovery: 6,
  adapter: 7,
  aborted: 130,
})

export interface CliRuntime {
  readonly cwd?: string
  readonly stdout?: (text: string) => void
  readonly stderr?: (text: string) => void
  readonly signal?: AbortSignal
  readonly loadConfig?: (path: string) => Promise<QubuCliConfig>
}

interface CommandResult {
  readonly exitCode: number
}

const format = option({
  long: "format",
  type: oneOf(["human", "json"] as const),
  defaultValue: () => "human" as const,
  defaultValueIsSerializable: true,
})
const configPath = option({
  long: "config",
  type: string,
  defaultValue: () => "qubu.config.js",
  defaultValueIsSerializable: true,
})
const nonInteractive = flag({
  long: "non-interactive",
  description: "Never prompt; fail when explicit input is missing",
})

export function createCli(runtime: CliRuntime = {}) {
  const invoke =
    <T extends Record<string, unknown>>(action: (args: T, context: Context) => Promise<unknown>) =>
    async (
      args: T & {
        format: "human" | "json"
        config: string
      },
    ): Promise<CommandResult> => {
      try {
        const context = await loadContext(args.config, runtime)
        const value = await action(args, context)

        emit(runtime.stdout, renderSuccess(value, args.format))
        return { exitCode: 0 }
      } catch (error) {
        const failure = safeError(error, runtime.signal?.aborted === true)

        emit(
          runtime.stderr,
          args.format === "json"
            ? stableJson({
                ok: false,
                error: failure,
              })
            : `Error [${failure.code}]: ${failure.message}\n`,
          "stderr",
        )
        return { exitCode: failure.exitCode }
      }
    }

  const verify = command({
    name: "verify",
    description: "Verify every artifact and the complete repository chain",
    args: {
      config: configPath,
      format,
      nonInteractive,
    },
    handler: invoke(async (_args, context) => {
      const chain = await verifyArtifactChain(context.repository)

      if (!chain.ok) {
        throw new CliFailure(
          "validation",
          "Artifact repository validation failed",
          chain.diagnostics,
        )
      }

      return {
        ok: true,
        command: "migrate verify",
        artifacts: chain.artifacts.length,
        head: chain.head,
      }
    }),
  })

  const status = command({
    name: "status",
    description: "Inspect drift, recovery state, and pending artifacts",
    args: {
      config: configPath,
      format,
      nonInteractive,
    },
    handler: invoke(async (_args, context) => {
      const result = await readMigrationStatus({
        repository: context.repository,
        adapter: await resolveAdapter(context.config),
        signal: context.signal,
      })

      if (result.interruptedAttempts.length) {
        throw new CliFailure("recovery-required", "Migration recovery is required", result)
      }

      if (result.diagnostics.length) {
        throw new CliFailure("validation", "Migration status is invalid", result)
      }

      if (result.managedDrift && !result.managedDrift.matches) {
        throw new CliFailure("drift", "Managed schema drift detected", result)
      }

      if (result.incompatibleRequirements.length) {
        throw new CliFailure("policy", "Adapter requirements are incompatible", result)
      }

      return {
        ok: true,
        command: "migrate status",
        ...result,
      }
    }),
  })

  const apply = command({
    name: "apply",
    description: "Apply the complete verified pending chain",
    args: {
      config: configPath,
      format,
      nonInteractive,
      dryRun: flag({ long: "dry-run" }),
    },
    handler: invoke(async (args, context) => {
      if (args.dryRun) {
        const result = await readMigrationStatus({
          repository: context.repository,
          adapter: await resolveAdapter(context.config),
          signal: context.signal,
        })

        if (result.diagnostics.length) {
          throw new CliFailure("validation", "Migration preflight failed", result.diagnostics)
        }

        if (result.managedDrift && !result.managedDrift.matches) {
          throw new CliFailure("drift", "Managed schema drift detected")
        }

        if (result.incompatibleRequirements.length) {
          throw new CliFailure(
            "policy",
            "Adapter requirements are incompatible",
            result.incompatibleRequirements,
          )
        }

        return {
          ok: true,
          command: "migrate apply",
          dryRun: true,
          pending: result.pending.map(summary),
        }
      }

      const result = await executeMigrations({
        repository: context.repository,
        adapter: await resolveAdapter(context.config),
        options: { signal: context.signal },
      })

      return {
        ok: true,
        command: "migrate apply",
        ...result,
      }
    }),
  })

  const create = command({
    name: "create",
    description: "Create and seal a migration artifact",
    args: {
      id: positional({ displayName: "id" }),
      config: configPath,
      format,
      nonInteractive,
      approvals: multioption({
        long: "approve",
        type: array(string),
        description: "Exact operation approval as operation-id=reason",
      }),
      approvedBy: option({
        long: "approved-by",
        type: optional(string),
      }),
      dryRun: flag({ long: "dry-run" }),
    },
    handler: invoke(async (args, context) => createMigration(args, context)),
  })

  const confirmationNames = [
    "database-target",
    "snapshot-source",
    "zero-managed-drift",
    "backup-restore-ready",
    "other-migrators-stopped",
    "application-compatible",
    "legacy-history-cutover",
  ] as const
  const baseline = command({
    name: "baseline",
    description: "Verify live schema and record an explicit baseline",
    args: {
      id: positional({ displayName: "id" }),
      config: configPath,
      format,
      nonInteractive,
      confirmations: multioption({
        long: "confirm",
        type: array(string),
        description: `Required facts: ${confirmationNames.join(", ")}`,
      }),
      dryRun: flag({ long: "dry-run" }),
    },
    handler: invoke(async (args, context) => {
      const supplied = new Set(args.confirmations)
      const missing = confirmationNames.filter((name) => !supplied.has(name))
      const unknown = args.confirmations.filter((name) => !confirmationNames.includes(name as any))

      if (missing.length || unknown.length) {
        throw new CliFailure("policy", "Baseline requires all seven exact confirmation facts", {
          missing,
          unknown,
          environment: context.config.environment ?? "development",
        })
      }

      const chain = await verifyArtifactChain(context.repository)

      if (!chain.ok) {
        throw new CliFailure(
          "validation",
          "Artifact repository validation failed",
          chain.diagnostics,
        )
      }

      if (chain.artifacts.length) {
        throw new CliFailure("policy", "A baseline requires an empty artifact repository")
      }

      const snapshot = await resolveConfigSnapshot(context.config)

      if (args.dryRun) {
        return {
          ok: true,
          command: "migrate baseline",
          dryRun: true,
          confirmations: [...confirmationNames],
        }
      }

      const result = await createBaseline({
        adapter: await resolveAdapter(context.config),
        id: args.id,
        snapshot,
        provenance: provenance(context.config),
        confirmation: baselineConfirmation(),
        constraints: context.config.constraints,
        operator: context.config.baselineOperator,
        signal: context.signal,
      })
      const path = await context.repository.write(result.artifact)

      return {
        ok: true,
        command: "migrate baseline",
        artifact: summary(result.artifact),
        path,
        unmanagedObjects: result.unmanagedObjects,
      }
    }),
  })

  const reconcile = command({
    name: "reconcile",
    description: "Resolve an interrupted attempt after application-owned verification",
    args: {
      attempt: positional({ displayName: "attempt-id" }),
      outcome: option({
        long: "outcome",
        type: oneOf(["applied", "rolled_back"] as const),
      }),
      reason: option({
        long: "reason",
        type: string,
      }),
      config: configPath,
      format,
      nonInteractive,
    },
    handler: invoke(async (args, context) => {
      if (!context.config.verifyReconciliation) {
        throw new CliFailure("policy", "Config must define verifyReconciliation")
      }

      const snapshot = await resolveConfigSnapshot(context.config)
      const chain = await verifyArtifactChain(context.repository)

      if (!chain.ok) {
        throw new CliFailure(
          "validation",
          "Artifact repository validation failed",
          chain.diagnostics,
        )
      }

      const adapter = await resolveAdapter(context.config)
      const session = await adapter.openMigrationSession(context.signal)
      let leased = false

      try {
        await session.acquireLease(context.signal)
        leased = true
        const attempt = (await session.journal.listAttempts()).find(
          (item) => item.id === args.attempt,
        )
        const artifact = chain.artifacts.find(
          (item) =>
            item.format === "qubu-executable-migration" &&
            item.artifactDigest === attempt?.artifactDigest,
        )

        await reconcileAttempt({
          journal: session.journal,
          attemptId: args.attempt,
          outcome: args.outcome,
          reason: args.reason,
          artifact: artifact?.format === "qubu-executable-migration" ? artifact : undefined,
          verify: () =>
            context.config.verifyReconciliation!({
              attemptId: args.attempt,
              outcome: args.outcome,
              snapshot,
              signal: context.signal,
            }),
        })
      } finally {
        if (leased) {
          await session.releaseLease()
        }

        await session.close()
      }

      return {
        ok: true,
        command: "migrate reconcile",
        attemptId: args.attempt,
        outcome: args.outcome,
      }
    }),
  })

  const bootstrap = command({
    name: "bootstrap",
    description: "Plan or execute a fresh schema through the migration executor",
    args: {
      config: configPath,
      format,
      nonInteractive,
      dryRun: flag({ long: "dry-run" }),
      approvals: multioption({
        long: "approve",
        type: array(string),
      }),
    },
    handler: invoke(async (args, context) => {
      const target = await resolveConfigSnapshot(context.config)
      const planned = planSchemaBootstrap(target)

      if (!planned.ok) {
        throw new CliFailure("validation", "Schema bootstrap planning failed", planned.diagnostics)
      }

      const approvals = await approvalsFor(planned.plan, args.approvals, undefined, context.config)
      const compiled = compileMigrationProgram(planned.plan, schemaDialectFor(target), {
        approvals,
        customPrograms: context.config.customPrograms,
        serverVersion: context.config.serverVersion,
      })

      if (!compiled.ok) {
        throw new CliFailure(
          "policy",
          "Schema bootstrap requires operation-scoped approval",
          compiled.diagnostics,
        )
      }

      if (args.dryRun) {
        return {
          ok: true,
          command: "schema bootstrap",
          dryRun: true,
          phases: compiled.program.phases,
        }
      }

      const artifact = await sealExecutableArtifact({
        format: "qubu-executable-migration",
        version: 1,
        id: "schema-bootstrap",
        sequence: 0,
        parentArtifactDigest: null,
        dialect: target.dialect,
        constraints: context.config.constraints,
        plan: planned.plan,
        renderer: renderer(context.config, target),
        program: compiled.program,
        beforeSnapshot: { value: planned.beforeSnapshot },
        afterSnapshot: { value: target },
        approvals,
        customPrograms: compiled.customPrograms,
        provenance: provenance(context.config),
      })
      const result = await executeMigrations({
        repository: [artifact],
        adapter: await resolveAdapter(context.config),
        options: { signal: context.signal },
      })

      return {
        ok: true,
        command: "schema bootstrap",
        ...result,
      }
    }),
  })

  return subcommands({
    name: "qubu",
    description: "Portable Qubu migration operations",
    cmds: {
      migrate: subcommands({
        name: "migrate",
        cmds: {
          create,
          verify,
          status,
          apply,
          baseline,
          reconcile,
        },
      }),
      schema: subcommands({
        name: "schema",
        cmds: { bootstrap },
      }),
    },
  })
}

export async function runCli(args: readonly string[], runtime: CliRuntime = {}): Promise<number> {
  const result = await runSafely(createCli(runtime), [...args])

  if (result._tag === "error") {
    const { exitCode, into, message } = result.error.config

    emit(runtime[into], `${message}\n`, into)
    return exitCode === 0 ? cliExitCodes.success : cliExitCodes.usage
  }

  let value: any = result.value

  while (value && typeof value === "object" && "value" in value) {
    value = value.value
  }

  return value?.exitCode ?? cliExitCodes.success
}

interface Context {
  readonly config: QubuCliConfig
  readonly repository: FileArtifactRepository
  readonly signal: AbortSignal
}

async function loadContext(configPath: string, runtime: CliRuntime): Promise<Context> {
  const cwd = runtime.cwd ?? process.cwd()
  const path = resolve(cwd, configPath)
  const config = runtime.loadConfig
    ? await runtime.loadConfig(path)
    : await import(pathToFileURL(path).href).then((module) => module.default as QubuCliConfig)

  if (
    !config ||
    typeof config !== "object" ||
    typeof config.artifacts !== "string" ||
    !config.artifacts.trim()
  ) {
    throw new CliFailure("validation", "Config must define a non-empty artifacts directory")
  }

  const controller = new AbortController()

  if (runtime.signal) {
    runtime.signal.addEventListener("abort", () => controller.abort(runtime.signal?.reason), {
      once: true,
    })
  }

  if (runtime.signal?.aborted) {
    controller.abort(runtime.signal.reason)
  }

  return {
    config,
    repository: new FileArtifactRepository(config.artifacts, cwd),
    signal: controller.signal,
  }
}

async function createMigration(
  args: {
    id: string
    approvals: string[]
    approvedBy?: string
    dryRun: boolean
  },
  context: Context,
) {
  const target = await resolveConfigSnapshot(context.config)
  const chain = await verifyArtifactChain(context.repository)

  if (!chain.ok) {
    throw new CliFailure("validation", "Artifact repository validation failed", chain.diagnostics)
  }

  const previous = chain.artifacts.at(-1)
  const before = previous
    ? previous.format === "qubu-executable-migration"
      ? previous.afterSnapshot.value
      : previous.snapshot.value
    : emptySnapshot(target)

  if (!before || before.format !== "qubu-schema" || before.version !== 1) {
    throw new CliFailure("validation", "The previous artifact must embed a version 1 snapshot")
  }

  const planned = createMigrationPlan(diffSnapshots(before, target), {
    allowUnknown: true,
    allowLossy: true,
    allowUnsupported: true,
    allowDestructive: true,
    allowReviewRequired: true,
  })

  if (!planned.ok) {
    throw new CliFailure("validation", "Migration planning failed", planned.diagnostics)
  }

  const approvals = await approvalsFor(
    planned.plan,
    args.approvals,
    args.approvedBy,
    context.config,
  )
  const compiled = compileMigrationProgram(planned.plan, schemaDialectFor(target), {
    approvals,
    customPrograms: context.config.customPrograms,
    serverVersion: context.config.serverVersion,
  })

  if (!compiled.ok) {
    throw new CliFailure(
      "policy",
      "Migration sealing requires operation-scoped approval",
      compiled.diagnostics,
    )
  }

  const artifact = await sealExecutableArtifact({
    format: "qubu-executable-migration",
    version: 1,
    id: args.id,
    sequence: chain.artifacts.length,
    parentArtifactDigest: chain.head,
    dialect: target.dialect,
    constraints: context.config.constraints,
    plan: planned.plan,
    renderer: renderer(context.config, target),
    program: compiled.program,
    beforeSnapshot: { value: before },
    afterSnapshot: { value: target },
    approvals,
    customPrograms: compiled.customPrograms,
    provenance: provenance(context.config),
  })

  if (args.dryRun) {
    return {
      ok: true,
      command: "migrate create",
      dryRun: true,
      artifact: summary(artifact),
    }
  }

  const path = await context.repository.write(artifact)

  return {
    ok: true,
    command: "migrate create",
    artifact: summary(artifact),
    path,
  }
}

async function approvalsFor(
  plan: ReturnType<typeof createMigrationPlan> extends {
    ok: true
    plan: infer P
  }
    ? P
    : never,
  values: readonly string[],
  approvedBy: string | undefined,
  config: QubuCliConfig,
): Promise<OperationApproval[]> {
  const requested = new Map(
    values.map((value) => {
      const index = value.indexOf("=")

      if (index < 1 || !value.slice(index + 1).trim()) {
        throw new CliFailure("usage", "--approve must use operation-id=reason")
      }

      return [value.slice(0, index), value.slice(index + 1)]
    }),
  )
  const approvals: OperationApproval[] = []

  for (const operation of plan.operations) {
    const findings = plan.diagnostics
      .filter((item) => item.operationId === operation.id)
      .map((item) => item.code)
      .toSorted()
    const requestedReason = requested.get(operation.id)
    const policy = await config.approvals?.({
      operation,
      findings,
      requestedReason,
    })

    if (policy) {
      approvals.push(policy)
    } else if (requestedReason) {
      approvals.push({
        operationId: operation.id,
        decision: config.customPrograms?.some((item) => item.operationId === operation.id)
          ? "custom-program"
          : "approve",
        safety: operation.safety,
        findings,
        reason: requestedReason,
        ...(approvedBy ? { approvedBy } : {}),
        approvedAt: new Date().toISOString(),
      })
    }

    requested.delete(operation.id)
  }

  if (requested.size) {
    throw new CliFailure("policy", "Approval references unknown operation IDs", [
      ...requested.keys(),
    ])
  }

  return approvals
}

function renderer(config: QubuCliConfig, snapshot: SchemaSnapshot) {
  return (
    config.renderer ?? {
      id: `qubu-${snapshot.dialect.name}`,
      version: 1,
      dialect: snapshot.dialect,
    }
  )
}

function schemaDialectFor(snapshot: SchemaSnapshot): SchemaDialect {
  if (snapshot.dialect.name === "sqlite") {
    return sqliteSchemaDialect
  }

  if (snapshot.dialect.name === "postgres") {
    return postgresSchemaDialect
  }

  if (snapshot.dialect.name === "mysql") {
    return mysqlSchemaDialect
  }

  throw new CliFailure("validation", `Unsupported schema dialect ${snapshot.dialect.name}`)
}

function provenance(config: QubuCliConfig) {
  return config.provenance ?? { source: "@qubu/cli" }
}

function emptySnapshot(target: SchemaSnapshot): SchemaSnapshot {
  return {
    format: "qubu-schema",
    version: 1,
    dialect: target.dialect,
    namingPolicy: target.namingPolicy,
    namespace: target.namespace,
    tables: [],
  }
}

function baselineConfirmation(): BaselineConfirmation {
  return {
    databaseTargetVerified: true,
    snapshotSourceVerified: true,
    zeroManagedDriftVerified: true,
    backupRestoreReady: true,
    otherMigratorsStopped: true,
    applicationCompatible: true,
    legacyHistoryCutoverAccepted: true,
  }
}

function summary(artifact: MigrationArtifact) {
  return {
    id: artifact.id,
    sequence: artifact.sequence,
    format: artifact.format,
    artifactDigest: artifact.artifactDigest,
    parentArtifactDigest: artifact.parentArtifactDigest,
  }
}

function renderSuccess(value: unknown, format: "human" | "json") {
  return format === "json" ? stableJson(value) : `${human(value)}\n`
}

function human(value: any): string {
  if (value?.command) {
    const count = value.applied?.length ?? value.pending?.length ?? value.artifacts

    return count === undefined ? `${value.command}: ok` : `${value.command}: ${count}`
  }

  return "ok"
}

function emit(
  writer: ((text: string) => void) | undefined,
  text: string,
  fallback: "stdout" | "stderr" = "stdout",
) {
  ;(writer ?? ((value) => process[fallback].write(value)))(text)
}

class CliFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

function safeError(error: unknown, aborted = false) {
  const code =
    aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "aborted"
      : error instanceof CliFailure
        ? error.code
        : error instanceof MigrationExecutionError
          ? error.code
          : "adapter"
  const exitCode =
    code === "usage"
      ? cliExitCodes.usage
      : code === "validation"
        ? cliExitCodes.validation
        : code === "policy" || code === "capability"
          ? cliExitCodes.policy
          : code === "drift"
            ? cliExitCodes.drift
            : code === "recovery-required" || code === "recovery"
              ? cliExitCodes.recovery
              : code === "aborted"
                ? cliExitCodes.aborted
                : cliExitCodes.adapter

  return redact({
    code,
    message: error instanceof Error ? error.message : "Command failed",
    ...(error instanceof CliFailure && error.details !== undefined
      ? { details: error.details }
      : {}),
    exitCode,
  })
}

function redact(value: any, key = ""): any {
  if (/password|token|secret|credential|authorization|cookie|url/iu.test(key)) {
    return "[REDACTED]"
  }

  if (typeof value === "string") {
    return value
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
      .replace(/([?&](?:token|password|secret|key)=)[^\s&#]*/giu, "$1[REDACTED]")
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item))
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((child) => [child, redact(value[child], child)]),
    )
  }

  return value
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(redact(value), (_key, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.entries(child).toSorted(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : child,
  )}\n`
}
