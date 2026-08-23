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

The current CI matrix runs the three Node.js scenarios. A verified module
exports one async `verify(context)` function. It prepares its own schema and
data and uses the connection supplied by the runner. The provisioner owns the
isolated database lifetime.

The combo checkout expects the parent Qubu checkout at `..`. Its package
dependency is `qubu: link:../../..` from `packages/combo-runner`, so local
checks build the parent package before compiling scenarios. CI checks out
`aleclarson/qubu` at `qubu` and the `combos` branch at `qubu/combos`.

The Node launcher resolves `./scenarios/...` paths from the compiled package
root. Bun, Deno, Workers, and browser launchers use the same
`RuntimeLauncher` and `ScenarioLoader` seam and will receive native module
loaders when their scenarios land.
