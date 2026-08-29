# Lotta Games adoption

> Replace Lotta's provisional runner with Qubu while preserving product-owned deployment policy and historical truth.

Adopt the released `@qubu/migrate`, `@qubu/cli`, and libSQL migration entrypoint
as a hard cutover. Do not add an upstream decoder for Lotta's provisional JSON,
FNV artifact digests, journal, or broad unsafe flags.

Before changing downstream state, inspect every environment for a provisional
journal or baseline row. Regenerate unreleased migrations in the Qubu artifact
format. For an existing database, create one standard baseline only after strict
live introspection matches the intended Qubu snapshot. That baseline records a
verified starting state; it does not claim that old migrations ran through
Qubu.

Keep these concerns in Lotta:

- Turso credentials and environment selection;
- Cloudflare deployment waiting and migrate-first/migrate-last prompts;
- the destructive-deny approval policy and product-specific custom programs;
- rollout timing and the one-time legacy journal cutover decision.

Replace the private migration and runner modules with thin configuration and
CLI/library invocation. Make the release script apply the complete pending
repository chain and preserve non-zero failures. Generate fresh local test
databases with `schema bootstrap`; keep connection PRAGMAs in the test harness.

> [!WARNING]
> Keep Drizzle migration SQL and snapshots read-only. Do not import or replay
> Drizzle history. A verified baseline is the handoff from historical state to
> Qubu lineage.

The downstream verification set should cover a fresh bootstrap, an already
baselined database, a no-op deploy, pending migrations in both deployment
timing modes, drift refusal, concurrent invocation, rollback, and explicit
recovery.

## Combo-matrix release blocker

The main repository currently pins the `combos` submodule gitlink to
`2e2856e5692ef5cbef03a055fa71e5baab8ec10a`. Commit `d9d2e02` added and verified
migration profiles in the main repository without advancing that gitlink, so
the orphan-branch adapter × environment matrix is not yet synchronized with the
new profile claims. This is an unresolved pinned-SHA issue, not evidence that
the matrix has verified the new migration entrypoints.

Do not edit the gitlink or matrix as part of Lotta adoption. Before release,
update the `combos` branch in its own review, run the declared environments and
real database round trips, classify every candidate pair, then advance the main
repository gitlink to that reviewed commit in a separate change.
