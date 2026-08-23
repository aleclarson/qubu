import test from "node:test";
import assert from "node:assert/strict";
import { defineRegistry, type ComboRegistry } from "./catalog.js";
import { createDisposableProvisioner } from "./provisioners.js";
import { resolveNodeScenario } from "./launchers/node.js";
import { createRuntimeLauncher } from "./launchers/runtime.js";
import { runCombo } from "./runner.js";
import type { VerificationContext } from "./contract.js";

const verifiedRegistry: ComboRegistry = defineRegistry({
  adapters: [
    {
      id: "node-sqlite/sqlite",
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
      key: "node-sqlite/sqlite/node",
      adapter: "node-sqlite/sqlite",
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
    { adapter: "node-sqlite/sqlite", environment: "node" },
    {
      registry: verifiedRegistry,
      launchers: { node: launcher },
      provisioners: { "node-sqlite/sqlite/node": provisioner },
    },
    { runId: "test-run" },
  );

  assert.equal(result.runId, "test-run");
  assert.deepEqual(events, ["import:test:scenario", "verify:sqlite", "dispose"]);
});

test("runner rejects a non-verified cell before provisioning", async () => {
  await assert.rejects(
    runCombo(
      { adapter: "node-sqlite/sqlite", environment: "node" },
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

test("registry rejects a combo key that disagrees with its explicit fields", () => {
  assert.throws(
    () =>
      defineRegistry({
        ...verifiedRegistry,
        combos: [
          {
            ...verifiedRegistry.combos[0],
            key: "node-sqlite/sqlite/bun",
          },
        ],
      }),
    /does not match its adapter and environment/,
  );
});

test("runner selects a provisioner by combo key", async () => {
  const events: string[] = [];
  const secondRegistry = defineRegistry({
    ...verifiedRegistry,
    environments: [
      verifiedRegistry.environments[0],
      {
        id: "bun",
        label: "Bun",
        runtimeCommand: "bun",
        notes: "test runtime",
      },
    ],
    combos: [
      verifiedRegistry.combos[0],
      {
        ...verifiedRegistry.combos[0],
        key: "node-sqlite/sqlite/bun",
        environment: "bun",
        scenario: "test:second-scenario",
      },
    ],
  });
  const firstProvisioner = createDisposableProvisioner("sqlite", async () => ({
    connection: "first",
    async close() {
      events.push("dispose:first");
    },
  }));
  const secondProvisioner = createDisposableProvisioner("sqlite", async () => ({
    connection: "second",
    async close() {
      events.push("dispose:second");
    },
  }));
  const launcher = createRuntimeLauncher("bun", async () => ({
    async verify(context: VerificationContext) {
      events.push(String(context.database.connection));
    },
  }));

  await runCombo(
    { adapter: "node-sqlite/sqlite", environment: "bun" },
    {
      registry: secondRegistry,
      launchers: { bun: launcher },
      provisioners: {
        "node-sqlite/sqlite/node": firstProvisioner,
        "node-sqlite/sqlite/bun": secondProvisioner,
      },
    },
  );

  assert.deepEqual(events, ["second", "dispose:second"]);
});

test("Node scenario paths resolve from the compiled package root", () => {
  const resolved = resolveNodeScenario("./scenarios/node/pg.js");
  assert.equal(
    String(resolved),
    new URL("./scenarios/node/pg.js", import.meta.url).href,
  );
});
