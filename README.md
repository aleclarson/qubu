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

`pnpm check` typechecks the TypeScript workspace, runs the deterministic runner
tests, and checks that `docs/catalog.md` matches the registry renderer.

Use these commands while adding a scenario:

```bash
pnpm catalog:generate
pnpm ci:matrix
```

The CI matrix is empty until a cell is `verified` and points at a scenario
module. A verified module exports one async `verify(context)` function. It
prepares its own schema and data and uses the connection supplied by the
runner. The provisioner owns the isolated database lifetime.
