import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineRegistry, type ComboRegistry } from "./catalog.js";
import { createDisposableProvisioner } from "./provisioners.js";
import { createBrowserLauncher } from "./launchers/browser.js";
import { createCloudflareWorkersLauncher } from "./launchers/cloudflare-workers.js";
import { resolveNodeScenario } from "./launchers/node.js";
import {
  createNativeRuntimeLauncher,
  createRuntimeLauncher,
} from "./launchers/runtime.js";
import { runCombo } from "./runner.js";
import type { VerificationContext } from "./contract.js";
import type { LaunchRequest } from "./launchers/runtime.js";

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

function environmentRequest(environment: "browser" | "cloudflare-workers"): LaunchRequest {
  return {
    combo: {
      key:
        environment === "browser"
          ? "pglite/postgresql/browser"
          : "cloudflare-d1/sqlite/cloudflare-workers",
      adapter: environment === "browser" ? "pglite/postgresql" : "cloudflare-d1/sqlite",
      environment,
      engine: environment === "browser" ? "postgresql" : "sqlite",
      status: "verified" as const,
      scenario:
        environment === "browser"
          ? "./scenarios/browser/pglite.js"
          : "./scenarios/cloudflare-workers/d1.js",
    },
    scenario:
      environment === "browser"
        ? "./scenarios/browser/pglite.js"
        : "./scenarios/cloudflare-workers/d1.js",
    database: {
      engine: environment === "browser" ? ("postgresql" as const) : ("sqlite" as const),
      connection: undefined,
      async dispose() {},
    },
  };
}

test("Workers launcher tears down Wrangler and temporary D1 state after success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qubu-workers-test-"));
  let killed = false;
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.assign(child, { killed: false, exitCode: null });
  child.kill = (() => {
    killed = true;
    Object.assign(child, { killed: true, exitCode: 0 });
    child.emit("close", 0, null);
    return true;
  }) as ChildProcess["kill"];
  const responses = [
    new Response("ok", { status: 200 }),
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  ];
  const launcher = createCloudflareWorkersLauncher({
    createTempDirectory: async () => directory,
    allocatePort: async () => 43123,
    buildWorker: async (_request, path) => join(path, "worker.mjs"),
    spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
    fetchImpl: async () => responses.shift() ?? new Response("unexpected", { status: 500 }),
  });

  await launcher.launch(environmentRequest("cloudflare-workers"));

  assert.equal(killed, true);
  await assert.rejects(access(directory));
});

test("Workers launcher propagates an HTTP failure and still cleans up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qubu-workers-failure-test-"));
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.assign(child, { killed: false, exitCode: null });
  child.kill = (() => {
    Object.assign(child, { killed: true, exitCode: 0 });
    child.emit("close", 0, null);
    return true;
  }) as ChildProcess["kill"];
  const launcher = createCloudflareWorkersLauncher({
    createTempDirectory: async () => directory,
    allocatePort: async () => 43124,
    buildWorker: async (_request, path) => join(path, "worker.mjs"),
    spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
    fetchImpl: async (url) =>
      url.toString().endsWith("/health")
        ? new Response("ok", { status: 200 })
        : new Response("worker assertion failed", { status: 500 }),
  });

  await assert.rejects(
    launcher.launch(environmentRequest("cloudflare-workers")),
    /worker assertion failed/,
  );
  await assert.rejects(access(directory));
});

test("Workers launcher cancels a running Wrangler process and cleans up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qubu-workers-cancel-test-"));
  const controller = new AbortController();
  let killed = false;
  const child = new EventEmitter() as EventEmitter & Partial<ChildProcess>;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  Object.assign(child, { killed: false, exitCode: null });
  child.kill = (() => {
    killed = true;
    Object.assign(child, { killed: true, exitCode: 0 });
    child.emit("close", 0, null);
    return true;
  }) as ChildProcess["kill"];
  const launcher = createCloudflareWorkersLauncher({
    createTempDirectory: async () => directory,
    allocatePort: async () => 43126,
    buildWorker: async (_request, path) => join(path, "worker.mjs"),
    spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
    fetchImpl: async (url) => {
      if (url.toString().endsWith("/health")) {
        controller.abort(new Error("cancelled while running"));
      }
      return new Response("not ready", { status: 503 });
    },
  });

  await assert.rejects(
    launcher.launch({ ...environmentRequest("cloudflare-workers"), signal: controller.signal }),
    /cancelled while running/,
  );
  assert.equal(killed, true);
  await assert.rejects(access(directory));
});

test("browser launcher closes page, browser, server, and artifacts after failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qubu-browser-test-"));
  let pageClosed = false;
  let browserClosed = false;
  const launcher = createBrowserLauncher({
    createTempDirectory: async () => directory,
    allocatePort: async () => 43125,
    buildBrowser: async (_request, path) => join(path, "bundle.js"),
    launchBrowser: async () => ({
      async newPage() {
        return {
          async goto() {},
          async evaluate() {
            throw new Error("browser assertion failed");
          },
          async close() {
            pageClosed = true;
          },
        };
      },
      async close() {
        browserClosed = true;
      },
    }),
  });

  await assert.rejects(
    launcher.launch(environmentRequest("browser")),
    /browser assertion failed/,
  );
  assert.equal(pageClosed, true);
  assert.equal(browserClosed, true);
  await assert.rejects(access(directory));
});

test("environment launchers reject an already-aborted run before allocating resources", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled before launch"));
  let workersTempCreated = false;
  let browserTempCreated = false;
  await assert.rejects(
    createCloudflareWorkersLauncher({
      createTempDirectory: async () => {
        workersTempCreated = true;
        return mkdtemp(join(tmpdir(), "qubu-workers-abort-test-"));
      },
    }).launch({ ...environmentRequest("cloudflare-workers"), signal: controller.signal }),
    /cancelled before launch/,
  );
  await assert.rejects(
    createBrowserLauncher({
      createTempDirectory: async () => {
        browserTempCreated = true;
        return mkdtemp(join(tmpdir(), "qubu-browser-abort-test-"));
      },
    }).launch({ ...environmentRequest("browser"), signal: controller.signal }),
    /cancelled before launch/,
  );
  assert.equal(workersTempCreated, false);
  assert.equal(browserTempCreated, false);
});
