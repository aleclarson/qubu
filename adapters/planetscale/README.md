# `@qubu/adapter-planetscale`

> **Experimental:** this package is not production-ready. It has no
> provider-backed CI or live PlanetScale validation. Production hardening needs
> funded infrastructure and an external maintainer.

This package adapts `@planetscale/database` to Qubu's `QueryAdapter`
boundary:

```ts
import { connect } from "@planetscale/database"
import { planetScaleAdapter } from "@qubu/adapter-planetscale"
import { qubu } from "qubu"

const connection = connect({
  host: process.env.PLANETSCALE_HOST!,
  username: process.env.PLANETSCALE_USERNAME!,
  password: process.env.PLANETSCALE_PASSWORD!,
})
const db = qubu(planetScaleAdapter(connection))
```

The adapter uses Qubu's MySQL dialect, preserves the provider's date and
binary value formatting, maps `rowsAffected` and generated insert IDs, and
scopes Qubu transactions through the client's transaction callback. It can
execute EXPLAIN statements, but it does not advertise streaming or in-flight
cancellation because the serverless client does not expose those contracts.

## Limitations

This integration remains outside provider-backed CI until a sponsor or
maintainer supplies disposable PlanetScale infrastructure and owns production
hardening.

No migration adapter is provided.
No streaming or nested transaction/savepoint API is exposed. Abort signals
are checked before calls and before commit, without cancelling in-flight SQL.
