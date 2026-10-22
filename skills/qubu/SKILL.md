---
name: qubu
description: Route Qubu query, execution, schema, migration, and repair work to version-matched guides and API contracts. Use when a project depends on Qubu and the task needs Qubu-specific guidance.
---

# Qubu

Use the documentation shipped with the Qubu package in the current project.
Resolve the package first so the guidance matches the installed version:

```sh
node -e "const path=require.resolve('qubu/package.json'); console.log(require('node:path').join(require('node:path').dirname(path), 'docs'))"
```

If resolution fails, check the project's dependency and workspace setup. Do not
substitute docs from another checkout or version.

Start with the task guide; follow concept links only when a Qubu-specific rule
affects the work. Use the installed package's public TSDoc and declarations for
individual symbol behavior and exact signatures. The skill routes, guides show
composition, and API docs own symbol contracts; none should duplicate the others.

Choose the smallest relevant entry:

- first query or canonical `SELECT` style: `docs/getting-started.md` or
  `docs/guides/select/overview.md`
- optional predicates, result shape, cardinality, or query composition:
  `docs/guides/select/conditions.md`, `docs/query-model/result-shapes.md`, or
  `docs/guides/compose-queries.md`
- `INSERT`, `UPDATE`, or `DELETE`: `docs/guides/mutations.md`
- execute queries or choose an adapter: `docs/guides/execution.md`
- transactions, streams, plans, or lifecycle hooks: the matching guide under
  `docs/guides/` (`transactions.md`, `streaming.md`, `explain.md`, or `hooks.md`)
- rendering policies or a custom adapter: `docs/dialects-and-execution.md`
- a compile-time or runtime query failure: `docs/troubleshooting.md`
- schema metadata or storage: `docs/schema/tables-and-names.md`,
  `docs/schema/columns-and-writes.md`, or
  `docs/schema/storage-and-schema-sql.md`
- snapshots or catalog reads: `docs/schema/snapshots.md` or
  `docs/schema/introspection.md`
- snapshot comparison or migration planning:
  `docs/schema/diff.md` or `docs/schema/migration-plans.md`
- approved-plan DDL emission: `docs/schema/ddl-emission.md`
- apply, adopt, or recover migrations: `docs/migrations/index.md`, then the
  matching workflow; behavior belongs to `@qubu/migrate`, the CLI, or an adapter,
  not the `qubu` root
- custom expressions, sources, clauses, or dialects: the matching page under
  `docs/guides/extensions/`
- package ownership or entrypoint selection: `docs/reference/supported-surface.md`

Follow the documented package ownership and canonical source style. For related
packages, resolve their own installed declarations before relying on an API.
Keep guidance focused on Qubu's invariants, quirks, and failure modes; ordinary
SQL and TypeScript need no tutorial. Do not recreate API inventories or examples
in this skill.
