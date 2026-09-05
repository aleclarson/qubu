# `@qubu/adapter-cloudflare-d1`

> Adapt a Cloudflare D1 binding for SQLite queries and EXPLAIN.

```ts
import { d1Adapter } from "@qubu/adapter-cloudflare-d1"
import { qubu } from "qubu"

// Supply the application-owned client or database described above.
const db = qubu(d1Adapter(database))
```

## Limitations

- No callback transactions, query streaming, or D1 batch/session APIs are exposed.
- No query streaming is exposed. Abort signals are checked before execution, but do not cancel an in-flight driver query.
- After any custom encoder, parameters must be null, number, string, boolean, ArrayBuffer, or an ArrayBuffer view. Raw bigint, Date, objects, and undefined are rejected; use column codecs or an encoder to convert them.
- Insert IDs are omitted for zero changes, zero row IDs, and unsafe integers. D1 row IDs are connection metadata; use explicit returned keys when correctness depends on the inserted row’s identity.
- The `/migration` entry point exports only `d1MigrationProfile` with status `incompatible`: this binding does not provide the pinned interactive session required by the migration executor.

See [migration capability profiles](../../docs/migrations/adapters.md) for the
execution requirements of migration entry points.
