---
name: qubu
description: Route Qubu query, schema, and repair work to the exact installed package's canonical docs. Use when a project depends on Qubu and the task needs product guidance rather than a generic SQL answer.
---

# Qubu

Use the documentation shipped with the Qubu package in the current project.
Resolve the package first so the guidance matches the installed version:

```sh
node -e "const path=require.resolve('qubu/package.json'); console.log(require('node:path').join(require('node:path').dirname(path), 'docs'))"
```

If resolution fails, Qubu is not installed in the current project. Do not use
docs from another checkout or version as a substitute.

Read the smallest page that matches the task:

- first query or canonical `SELECT` style: `docs/getting-started.md` or
  `docs/guides/select/overview.md`
- optional predicates, result shape, cardinality, or query composition:
  `docs/guides/select/conditions.md`, `docs/query-model/result-shapes.md`, or
  `docs/guides/compose-queries.md`
- `INSERT`, `UPDATE`, or `DELETE`: `docs/guides/mutations.md`
- a compile-time or runtime query failure: `docs/troubleshooting.md`
- schema metadata or storage: `docs/schema/tables-and-names.md`,
  `docs/schema/columns-and-writes.md`, or
  `docs/schema/storage-and-schema-sql.md`
- snapshots or catalog reads: `docs/schema/snapshots.md` or
  `docs/schema/introspection.md`
- snapshot comparison or migration planning:
  `docs/schema/diff.md` or `docs/schema/migration-plans.md`
- approved-plan DDL emission: `docs/schema/ddl-emission.md`
- custom expressions, sources, clauses, or dialects: the matching page under
  `docs/guides/extensions/`
- package ownership or entrypoint selection: `docs/reference/supported-surface.md`

Follow the page's root/core/schema ownership and use its examples as the
canonical source style. If the task spans concerns, read the smallest page for
each concern and keep the installed package's `docs/` directory as the only
product reference. Do not recreate API inventories or examples in this skill.
