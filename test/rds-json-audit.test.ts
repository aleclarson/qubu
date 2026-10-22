import { expect, test } from "vitest"

import {
  rdsDataApiAdapter,
  type RdsDataApiCommand,
} from "../adapters/aws-rds-data-api/src/postgres.ts"
import { execute, insertInto, json, table, text, values } from "../src/index.ts"

test.each([
  {
    label: "string",
    input: "Ada",
  },
  {
    label: "number",
    input: 0.5,
  },
  {
    label: "boolean",
    input: false,
  },
  {
    label: "object",
    input: { name: "Ada" },
  },
  {
    label: "array",
    input: [1, 2],
  },
])(
  "serializes an RDS JSON $label parameter according to its declared SQL domain",
  async ({ input }) => {
    let parameters: unknown
    const adapter = rdsDataApiAdapter(
      {
        async send(command: RdsDataApiCommand) {
          if (!("sql" in command.input)) {
            throw new Error("Expected an ExecuteStatement request")
          }

          parameters = command.input.parameters
          return { numberOfRecordsUpdated: 1 }
        },
      },
      {
        resourceArn: "audit-resource",
        secretArn: "audit-secret",
      },
    )
    const records = table("audit_json_records", {
      payload: json<unknown>(),
      label: text(),
    })

    await execute(
      insertInto(
        records,
        values({
          payload: input,
          label: "ordinary text",
        }),
      ),
      adapter,
    )

    expect(parameters).toEqual([
      {
        name: "p1",
        value: { stringValue: JSON.stringify(input) },
        typeHint: "JSON",
      },
      {
        name: "p2",
        value: { stringValue: "ordinary text" },
      },
    ])
  },
)
