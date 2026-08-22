# Snapshot diffing

> Compare canonical Snapshot v1 or v2 values and review identity changes before a later planning step.

The optional `qubu/diff` entrypoint compares immutable snapshot data. It does
not open a connection, render SQL, execute a change, or infer migration history.
It keeps the object kind, namespace, logical ID, physical name, dialect, path,
and catalog evidence on every result object.

```ts
import { diffSnapshots } from 'qubu/diff'

const result = diffSnapshots(previousSnapshot, currentSnapshot)

for (const change of result.changes) {
  console.log(change.type, change.kind, change.logicalId)
}
```

The matcher first uses an explicit rename hint, then a stable logical ID. A
physical-name change for a stable match is a `physical-rename` operation. Other
matched fields become `property-change` operations. Unmatched records remain
separate `remove` and `add` operations.

## Explicit rename hints

Use a hint when an introspector or schema edit changed the logical ID as well as
the physical name. Hints are scoped by object kind and namespace. A target may
use an ID, a physical name, or an exact path when a nested scope repeats an ID.

```ts
const result = diffSnapshots(previousSnapshot, currentSnapshot, {
  renameHints: [
    {
      kind: 'table',
      namespace: 'public',
      from: 'legacy_accounts',
      to: 'accounts',
    },
  ],
})

result.renames[0]?.source // 'explicit-hint'
```

Hints must resolve to one object on each side. A wrong namespace, unsupported
kind, empty target, duplicate mapping, or target that resolves more than once
produces a diagnostic. `encodeSnapshotRenameHints()` writes deterministic JSON;
`decodeSnapshotRenameHints()` validates it without throwing.

## Suggestions and safety diagnostics

Structural matching can report a `rename-suggestion` with a confidence score and
evidence. Suggestions never enter `result.renames` and never replace the
corresponding add and remove operations. An ambiguous structural match reports
an `ambiguous` diagnostic and leaves both operations visible for review.

Removing an object is marked `destructive`. Narrowing nullability, changing
storage, removing a value, or changing a constraint can also receive that
classification. Opaque and deferred Snapshot v2 records remain visible as
`add` or `remove` data and produce `lossy` or `unsupported` diagnostics. They
cannot be silently promoted to a rename.

`result.equal` means that no diff operation was emitted. A result can therefore
be equal while still carrying a warning about an unchanged opaque record. The
diagnostics remain part of the review boundary.

Snapshot arrays are normalized by stable IDs or positions before comparison, so
reordering tables, object groups, columns, or other canonical collections does
not create changes. Ordered index terms, foreign-key columns, enum positions,
and routine parameter positions retain their meaning.

Diff output is data only. Migration planning, DDL rendering, and database
execution belong to later boundaries.
