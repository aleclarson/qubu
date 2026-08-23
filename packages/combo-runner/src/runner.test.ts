import test from "node:test";
import assert from "node:assert/strict";
import { defineRegistry, type ComboRegistry } from "./catalog.js";
import { createDisposableProvisioner } from "./provisioners.js";
import { createRuntimeLauncher } from "./launchers/runtime.js";
import { runCombo } from "./runner.js";
import type { VerificationContext } from "./contract.js";

const verifiedRegistry: ComboRegistry = defineRegistry({
  adapters: [
    {
      id: "node-sqlite",
      label: "node:sqlite",
      packageName: "node:sqlite",
      engine: "sqlite",
      declaredEnvironment: "node",
      notes: "test adapter",
    },
  ],
  environments: [
    {
      id: "node",
      label: "Node.js",
      runtimeCommand: "node",
      notes: "test runtime",
    },
  ],
  combos: [
    {
      key: "node-sqlite/node",
      adapter: "node-sqlite",
      environment: "node",
      engine: "sqlite",
      status: "verified",
      scenario: "test:scenario",
    },
  ],
});

test("runner imports a scenario and disposes the provisioned database", async () => {
  const events: string[] = [];
  const provisioner = createDisposableProvisioner("sqlite", async () => ({
    connection: { rows: [{ value: 1 }] },
    async close() {
      events.push("dispose");
    },
  }));
  const launcher = createRuntimeLauncher("node", async (specifier) => {
    events.push(`import:${String(specifier)}`);
    return {
      async verify(context: VerificationContext) {
        events.push(`verify:${context.database.engine}`);
        assert.deepEqual(context.database.connection, { rows: [{ value: 1 }] });
      },
    };
  });

  const result = await runCombo(
    { adapter: "node-sqlite", environment: "node" },
    {
      registry: verifiedRegistry,
      launchers: { node: launcher },
      provisioners: { sqlite: provisioner },
    },
    { runId: "test-run" },
  );

  assert.equal(result.runId, "test-run");
  assert.deepEqual(events, ["import:test:scenario", "verify:sqlite", "dispose"]);
});

test("runner rejects a non-verified cell before provisioning", async () => {
  await assert.rejects(
    runCombo(
      { adapter: "node-sqlite", environment: "node" },
      {
        registry: defineRegistry({
          ...verifiedRegistry,
          combos: [
            {
              ...verifiedRegistry.combos[0],
              status: "not-yet-written",
              scenario: undefined,
            },
          ],
        }),
        launchers: {},
        provisioners: {},
      },
    ),
    /only verified cells can run/,
  );
});
