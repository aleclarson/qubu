# Qubu combo scenarios

> This orphan branch tracks adapter/runtime scenarios separately from Qubu's
> core repository.

The typed registry in `packages/combo-runner/src/catalog.ts` is the source of
truth for seven engine-qualified adapters crossed with five runtimes. The
generated [combo catalog](docs/catalog.md) shows every cell and its current
status.

## Start here

```bash
pnpm install
pnpm check
```

`pnpm check` builds the linked Qubu checkout, typechecks the TypeScript
workspace, runs the deterministic runner tests, and checks that
`docs/catalog.md` matches the registry renderer.

Use these commands while adding a scenario:

```bash
pnpm catalog:generate
pnpm ci:matrix
```

The current CI matrix runs seven scenarios. A verified module exports one async
`verify(context)` function. It prepares its own schema and data and uses the
connection supplied by the runner. Native Bun and Deno scenarios open the
runner-supplied connection string inside their child runtime. Workers and
browser launchers create their database inside the declared isolate. The runner
invokes cleanup for every provisioned resource.

The combo checkout expects the parent Qubu checkout at `..`. Its package
dependency is `qubu: link:../../..` from `packages/combo-runner`, so local
checks build the parent package before compiling scenarios. CI checks out
`aleclarson/qubu` at `qubu` and the `combos` branch at `qubu/combos`.

The Node launcher resolves `./scenarios/...` paths from the compiled package
root and imports them in-process. Bun and Deno launch a compiled worker in the
declared runtime through a JSON context protocol. The Workers launcher bundles
a Worker entry and runs Wrangler with a temporary local D1 binding. The browser
launcher serves a temporary bundle and PGlite's WASM assets to headless
Chromium, then runs the scenario in page context.
