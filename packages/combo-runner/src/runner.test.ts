import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { defineRegistry, type ComboRegistry } from "./catalog.js";
import { createDisposableProvisioner } from "./provisioners.js";
import { resolveNodeScenario } from "./launchers/node.js";
import {
  createNativeRuntimeLauncher,
  createRuntimeLauncher,
} from "./launchers/runtime.js";
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

test("runner disposes a resource when an abort arrives after provisioning", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const provisioner = createDisposableProvisioner("sqlite", async () => {
    controller.abort(new Error("stop native child"));
    return {
      connection: "owned",
      async close() {
        events.push("dispose");
      },
    };
  });

  await assert.rejects(
    runCombo(
      { adapter: "node-sqlite/sqlite", environment: "node" },
      {
        registry: verifiedRegistry,
        launchers: { node: createRuntimeLauncher("node", async () => ({})) },
        provisioners: { "node-sqlite/sqlite/node": provisioner },
      },
      { signal: controller.signal },
    ),
    /stop native child/,
  );
  assert.deepEqual(events, ["dispose"]);
});

test("Node scenario paths resolve from the compiled package root", () => {
  const resolved = resolveNodeScenario("./scenarios/node/pg.js");
  assert.equal(
    String(resolved),
    new URL("./scenarios/node/pg.js", import.meta.url).href,
  );
});

test("native launcher sends only a JSON-safe locator to the runtime worker", async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const fakeSpawn = ((command: string, args: readonly string[]) => {
    calls.push({ command, args });
    const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => child.emit("close", 0, null));
    return child as ChildProcess;
  }) as unknown as typeof import("node:child_process").spawn;
  const launcher = createNativeRuntimeLauncher("bun", {
    command: "bun-test",
    worker: new URL("./native-worker.js", import.meta.url),
    spawnProcess: fakeSpawn,
  });

  await launcher.launch({
    combo: {
      key: "bun-sql/sqlite/bun",
      adapter: "bun-sql/sqlite",
      environment: "bun",
      engine: "sqlite",
      status: "verified",
      scenario: "./scenarios/bun/bun-sql.js",
    },
    scenario: "./scenarios/bun/bun-sql.js",
    database: {
      engine: "sqlite",
      connection: { notSerializable: true },
      connectionString: "sqlite:///tmp/qubu-test.sqlite",
      metadata: { database: "/tmp/qubu-test.sqlite" },
      async dispose() {},
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "bun-test");
  const payload = JSON.parse(calls[0]?.args.at(-1) ?? "null") as {
    readonly database: { readonly connectionString?: string; readonly connection?: unknown };
    readonly scenario: string;
  };
  assert.equal(payload.database.connectionString, "sqlite:///tmp/qubu-test.sqlite");
  assert.equal("connection" in payload.database, false);
  assert.match(payload.scenario, /\/scenarios\/bun\/bun-sql\.js$/);
});
