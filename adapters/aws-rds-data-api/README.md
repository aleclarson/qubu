# `@qubu/adapter-aws-rds-data-api`

> **Experimental:** this package is not production-ready. It has no
> provider-backed CI or live Aurora validation. Production hardening needs
> funded AWS infrastructure and an external maintainer.

Choose the dialect-specific entry point for the Aurora engine you use. Both
entry points adapt the AWS SDK's `RDSDataClient` to Qubu, and neither requires
an engine option:

```ts
import { RDSDataClient } from "@aws-sdk/client-rds-data"
import { rdsDataApiAdapter } from "@qubu/adapter-aws-rds-data-api/postgres"
import { qubu } from "qubu"

const client = new RDSDataClient({})
const db = qubu(
  rdsDataApiAdapter(client, {
    resourceArn: process.env.AURORA_RESOURCE_ARN!,
    secretArn: process.env.AURORA_SECRET_ARN!,
    database: "app",
  }),
)
```

For Aurora MySQL, change only the import:

```ts
import { rdsDataApiAdapter } from "@qubu/adapter-aws-rds-data-api/mysql"
```

Each adapter's `dialect` preserves its PostgreSQL or MySQL policy while
rendering AWS named placeholders (`:p1`, `:p2`, ...). The adapter encodes
nulls, booleans, numbers, strings, dates, bytes, and JSON as Data API fields;
it maps result metadata into object rows, affected-row counts, and generated
insert IDs. Callback transactions use the Data API's begin/execute/commit or
rollback transaction-ID sequence.

## Limitations

The adapter does not advertise streaming. AWS errors pass through unchanged,
and provider-backed cancellation/production behavior is not claimed. Data API
decimal and long results default to string form so precision is not silently
lost; override `resultSetOptions` only when numeric conversion is intentional.
This integration needs funded Aurora test infrastructure or an external
maintainer before production use.

The `schema` option is rejected when executing statements; qualify schema
identifiers in SQL instead. Abort signals are forwarded to AWS SDK requests,
but server-side cancellation guarantees have not been validated. No migration
adapter or nested transaction/savepoint API is provided.

Non-finite numbers and unsafe integer numbers are rejected. Pass large integers
as bigint or strings; dates must be valid and JSON values must be serializable.
