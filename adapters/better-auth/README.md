# `@qubu/better-auth`

> Derive auth tables from Better Auth metadata and run auth operations through a transactional Qubu client.

Use `qubuAdapter(db)` as Better Auth’s `database` option. Use
`betterAuthSchema(options, "postgresql")` (or `"mysql"` / `"sqlite"`) to share
the derived schema with Qubu’s schema and migration tools.
See the [Better Auth guide](../../docs/guides/better-auth.md) for setup.

## Limitations

- Only PostgreSQL, MySQL, and SQLite dialects are accepted. A transactional
  Qubu client is required even for atomic single-row operations; query-only
  adapters such as Neon HTTP and D1 cannot be used.
- Better Auth enum fields are rejected with model/field diagnostics because
  their closed value set cannot be represented losslessly. Unknown field types
  and invalid reference/index metadata also fail schema derivation.
- Better Auth bigint fields are exposed as JavaScript numbers; values outside
  the safe integer range throw instead of silently losing precision.
- The factory advertises no native JSON or array support to Better Auth.
  Dates are native only outside SQLite, and booleans only for PostgreSQL;
  Better Auth’s factory handles the corresponding serialization.
- Joined records are fetched with separate queries per base row and relation.
  Each relation defaults to at most 100 records unless its join limit is set.
- MySQL creation needs a supplied or returned insert ID to read the created
  row. It throws if that ID cannot be resolved.
- Schema generation produces Qubu metadata, not an applied database migration.
  Application-owned defaults marked external still need an external definition.
