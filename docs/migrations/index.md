# Migration operations

> Choose the package entrypoint that owns each migration concern without pulling database or Node.js behavior into pure schema code.

Qubu migrations are split across explicit ownership boundaries:

| Owner           | Imports                                            | Responsibility                                                                                                               |
| --------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `qubu`          | `qubu/snapshot`, `qubu/diff`, `qubu/introspection` | Pure schema snapshots, comparison, and catalog mapping                                                                       |
| `@qubu/migrate` | Focused subpaths listed below                      | Pure planning and compilation plus portable artifacts, journals, execution, status, baselines, and bootstrap                 |
| `@qubu/cli`     | `@qubu/cli/config`, `@qubu/cli/repository`         | Node.js configuration loading, artifact files, commands, output, and process exit behavior                                   |
| Adapter package | `@qubu/adapter-*/migration`                        | Pinned driver sessions, parameter binding, transactions, leases, locks, database journal storage, and failure classification |
| Application     | Its own configuration and deployment code          | Credentials, environment selection, approval policy, custom SQL, rollout timing, and legacy cutover decisions                |

The pre-alpha `qubu/migration` and `qubu/ddl` entrypoints no longer exist. Use
the extracted compiler entrypoints:

```ts
import { createMigrationPlan } from "@qubu/migrate/plan"
import { emitMigrationPlan } from "@qubu/migrate/ddl"
import { compileMigrationProgram, sealExecutableArtifact } from "@qubu/migrate/artifact"
```

The `@qubu/migrate` root intentionally exports only format/version constants
and the central plan and artifact types. Import behavior from its focused
entrypoint:

| Entrypoint                 | Use it for                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `@qubu/migrate/plan`       | Create, encode, decode, fingerprint, and validate migration plans          |
| `@qubu/migrate/ddl`        | Preview deterministic dialect SQL without opening a database               |
| `@qubu/migrate/artifact`   | Compile programs; canonicalize, digest, seal, encode, and decode artifacts |
| `@qubu/migrate/repository` | Verify a complete artifact chain and its journal prefix                    |
| `@qubu/migrate/journal`    | Implement or inspect the storage-neutral journal contract                  |
| `@qubu/migrate/executor`   | Apply artifacts and reconcile uncertain attempts                           |
| `@qubu/migrate/baseline`   | Verify and record the initial non-executable baseline                      |
| `@qubu/migrate/status`     | Inspect pending work, drift, requirements, and interrupted attempts        |
| `@qubu/migrate/bootstrap`  | Plan a fresh SQLite database through the normal compiler                   |
| `@qubu/migrate/testing`    | Test adapter capabilities and deterministic failure boundaries             |

Start with [Artifacts and approval policy](artifacts-and-policy.md) when
reviewing a migration format. Check [Adapter capability
profiles](adapters.md), use [Command line operations](operations.md) to
configure an application, then keep [Recovery and reconciliation](recovery.md)
with the deployment runbook. [Lotta Games adoption](lotta-adoption.md) records
the downstream cutover boundary and current combo-matrix blocker.
