# `@qubu/valtio-sync`

> Check synced fields against Qubu table types and commit each mutation with its sync event.

Use `defineAccount` or `defineCollection` with `$type<typeof table>()`, and wrap
server mutation handlers with `applyOpsWithQubu({ db, handlers, syncEvents })`.
See the [Valtio Sync guide](../../docs/guides/valtio-sync.md) for a complete example.

## Limitations

- `$type()` checks compatibility at compile time; it does not inspect the live
  database or generate runtime validators. Supply Zod schemas for every table
  field, using `serverOnly()` for fields excluded from synced records.
- `applyOpsWithQubu` requires a transactional Qubu client. Each mutation and its
  event write get one transaction; a whole batch of operations is not made atomic.
- The application supplies mutation queries, event tables and sequence allocation,
  authorization, conflict checks, and retention. Authorization and conflict hooks
  are optional; no policy is enforced automatically when they are omitted.
- Mutations and `syncEvents.write` must use the supplied `tx` for their database
  writes to participate in rollback. External side effects are outside it.
- Read handlers pass through unchanged; mutation authorization/conflict hooks do
  not wrap reads. The application must enforce read access itself.
- `serverOnly()` excludes schema fields from sync definitions; mutation handlers
  still own validation and persistence. The wrapper does not parse records or
  patches on their behalf.
