# TypeScript performance benchmark

> This corpus catches material increases in the compiler work required by
> representative public Qubu types.

Run the benchmark from the repository root:

```bash
pnpm run test:type-performance
```

The command builds Qubu, compiles the two files in this directory against the
generated public declarations, and reads TypeScript's extended diagnostics.
`core-query-composition.ts` covers joins, grouping, windows, correlated
subqueries, CTEs, aliases, and set operations. `sql-template-composition.ts`
mirrors the metadata-heavy cases in `test/sql-template-fixtures.ts`, including
nested templates, correlated queries, grouped aggregates, windows, left joins,
and dialect capabilities.

It fails when `Types` or `Instantiations` exceeds the absolute limit in
`thresholds.json`. Those counters are deterministic for the pinned compiler and
corpus. Memory and compiler timings remain informative because machines and
concurrent CI work affect them.

CI runs the command with `--check-built` after its explicit build step. That
flag skips the build and should only be used when `dist` matches the current
source.

```bash
pnpm run test:type-performance -- --check-built
```

`thresholds.json` records the measured baseline and a rounded limit with about
20% headroom. Run the command at least three times before changing a baseline.
The deterministic counters must agree across runs. Review the corpus and the
type changes that caused the increase before raising a limit. A TypeScript
upgrade also requires an explicit version and baseline update.
