# `@qubu/adapter-neon`

> **Experimental:** this package is not production-ready. It has no
> provider-backed CI or live Neon validation. Production hardening needs funded
> infrastructure and an external maintainer.

This package adapts the HTTP query function returned by
[`@neondatabase/serverless`](https://github.com/neondatabase/serverless) to
Qubu's `QueryAdapter` boundary:

```ts
import { neon } from "@neondatabase/serverless"
import { neonAdapter } from "@qubu/adapter-neon"
import { qubu } from "qubu"

const sql = neon(process.env.DATABASE_URL!)
const db = qubu(neonAdapter(sql))
```

The adapter uses Qubu's PostgreSQL dialect, requests full object results, and
maps mutation row counts. It can execute EXPLAIN statements, but it does not
advertise interactive transactions or streaming: Neon's HTTP query function
is a single-request/non-interactive boundary. Abort signals are forwarded to
the HTTP fetch request when supplied.

## Limitations

The package is intentionally kept outside provider-backed CI until a sponsor
or maintainer supplies disposable Neon infrastructure and owns production
hardening.

No migration adapter is provided.
Callback transactions and streaming are not exposed by this HTTP adapter.
