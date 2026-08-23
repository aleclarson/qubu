# Combo catalog

> This page is generated from `packages/combo-runner/src/catalog.ts`. Edit the typed registry, then run `pnpm catalog:generate`.

The combo library tracks one database-client adapter variant against each
runtime where someone might try to execute it. A combo is eligible for CI only
when its cell is `verified` and its scenario exports an async `verify`
function.

## Runtime flow

The registry supplies both the CI selection and the runtime/database choices.
The scenario owns schema setup, test data, and the Qubu query. The runner owns
the database lifetime.

```mermaid
flowchart LR
  registry[Typed registry] --> selection[CI selection]
  selection --> launcher[Environment launcher]
  runner[Shared runner] --> provisioner[Disposable provisioner]
  provisioner --> launcher
  launcher --> scenario[Scenario verify function]
```

## Adapter variants

There are exactly 7 engine-qualified adapter variants
and 5 environments, so the matrix contains
35 cells.

| ID | Adapter | Engine | Declared runtime |
| --- | --- | --- | --- |
| `node-sqlite/sqlite` | node:sqlite | sqlite | Node.js |
| `pg/postgresql` | pg | postgresql | Node.js |
| `mysql2-promise/mysql` | mysql2/promise | mysql | Node.js |
| `bun-sql/sqlite` | Bun.SQL/SQLite | sqlite | Bun |
| `postgresjs/postgresql` | postgres.js | postgresql | Deno |
| `cloudflare-d1/sqlite` | D1 binding | sqlite | Cloudflare Workers |
| `pglite/postgresql` | PGlite | postgresql | browser |

## Status counts

| Status | Cells | Meaning |
| --- | ---: | --- |
| `verified` | 3 | A scenario exports `verify`, runs in the declared runtime, and completes a live round trip. |
| `experimental` | 14 | The pairing may be useful, but it is not part of the verified CI set. |
| `incompatible` | 14 | The engine-qualified adapter entry point cannot run in this environment. |
| `not-yet-written` | 4 | This is a planned pairing with no scenario module yet. |

## Complete matrix

Every adapter/environment pair appears below. The status is a planning fact,
not a promise that the runtime can load a package without a scenario.

| Adapter | Node.js | Bun | Deno | Cloudflare Workers | browser |
| --- | --- | --- | --- | --- | --- |
| `node-sqlite/sqlite` | `verified` | `experimental` | `experimental` | `incompatible` | `incompatible` |
| `pg/postgresql` | `verified` | `experimental` | `experimental` | `experimental` | `incompatible` |
| `mysql2-promise/mysql` | `verified` | `experimental` | `experimental` | `incompatible` | `incompatible` |
| `bun-sql/sqlite` | `incompatible` | `not-yet-written` | `incompatible` | `incompatible` | `incompatible` |
| `postgresjs/postgresql` | `experimental` | `experimental` | `not-yet-written` | `experimental` | `incompatible` |
| `cloudflare-d1/sqlite` | `incompatible` | `incompatible` | `incompatible` | `not-yet-written` | `incompatible` |
| `pglite/postgresql` | `experimental` | `experimental` | `experimental` | `experimental` | `not-yet-written` |

## Verification targets

The three Node.js targets have live scenarios. The four remaining targets stay
pending for their native-runtime commits. Incompatible and experimental cells
stay in the complete matrix so a new scenario requires an explicit status
change.

| Adapter | Runtime | Status | Scenario |
| --- | --- | --- | --- |
| `node-sqlite/sqlite` | Node.js | `verified` | `./scenarios/node/node-sqlite.js` |
| `pg/postgresql` | Node.js | `verified` | `./scenarios/node/pg.js` |
| `mysql2-promise/mysql` | Node.js | `verified` | `./scenarios/node/mysql2-promise.js` |
| `bun-sql/sqlite` | Bun | `not-yet-written` | pending |
| `postgresjs/postgresql` | Deno | `not-yet-written` | pending |
| `cloudflare-d1/sqlite` | Cloudflare Workers | `not-yet-written` | pending |
| `pglite/postgresql` | browser | `not-yet-written` | pending |

## Commands

Install the workspace and run its deterministic checks:

```bash
pnpm install
pnpm check
```

Regenerate this page after a registry edit:

```bash
pnpm catalog:generate
```

Print the JSON matrix that CI will execute. This commit selects the three Node
scenarios:

```bash
pnpm ci:matrix
```

## Adding a verified scenario

Add a module under `packages/combo-runner/src/scenarios/` that exports one
async `verify(context)` function. The function should prepare its own small
schema and data, execute a bound Qubu query, assert the returned rows, and
clean up scenario-owned objects. Then add its module specifier to the target
cell, change that cell to `verified`, and provide the matching launcher and
provisioner in the CI runtime.

The Node launcher resolves a scenario path relative to the compiled package
root. Other launchers keep the same `RuntimeLauncher` and injected
`ScenarioLoader` contracts, so a native runtime or bundler can supply its own
module import in a later commit.
