import test from "node:test";
import assert from "node:assert/strict";
import {
  ADAPTER_IDS,
  ENVIRONMENT_IDS,
  comboRegistry,
  comboKey,
  findCombo,
  statusCounts,
} from "./catalog.js";
import { renderCatalog } from "./catalog-markdown.js";
import { selectCiMatrix } from "./runner.js";

test("catalog covers every adapter and environment exactly once", () => {
  assert.equal(comboRegistry.adapters.length, 7);
  assert.equal(comboRegistry.environments.length, 5);
  assert.equal(comboRegistry.combos.length, 35);

  const keys = new Set(comboRegistry.combos.map((combo) => combo.key));
  assert.equal(keys.size, 35);
  for (const adapter of ADAPTER_IDS) {
    for (const environment of ENVIRONMENT_IDS) {
      assert.ok(keys.has(comboKey(adapter, environment)));
    }
  }
});

test("verified targets have scenarios and later targets remain unwritten", () => {
  const targetCells = [
    ["node-sqlite/sqlite", "node", "verified"],
    ["pg/postgresql", "node", "verified"],
    ["mysql2-promise/mysql", "node", "verified"],
    ["bun-sql/sqlite", "bun", "verified"],
    ["postgresjs/postgresql", "deno", "verified"],
    ["cloudflare-d1/sqlite", "cloudflare-workers", "not-yet-written"],
    ["pglite/postgresql", "browser", "not-yet-written"],
  ] as const;

  for (const [adapter, environment, status] of targetCells) {
    const combo = findCombo(comboRegistry, adapter, environment);
    assert.equal(combo.status, status);
    if (status === "verified") {
      assert.match(combo.scenario ?? "", /^\.\/scenarios\/(node|bun|deno)\/.+\.js$/);
    }
  }
  assert.equal(statusCounts().verified, 5);
});

test("CI selection contains only verified scenarios", () => {
  assert.deepEqual(
    selectCiMatrix().map(({ key, adapter, environment, engine, scenario }) => ({
      key,
      adapter,
      environment,
      engine,
      scenario,
    })),
    [
      {
        key: "node-sqlite/sqlite/node",
        adapter: "node-sqlite/sqlite",
        environment: "node",
        engine: "sqlite",
        scenario: "./scenarios/node/node-sqlite.js",
      },
      {
        key: "pg/postgresql/node",
        adapter: "pg/postgresql",
        environment: "node",
        engine: "postgresql",
        scenario: "./scenarios/node/pg.js",
      },
      {
        key: "mysql2-promise/mysql/node",
        adapter: "mysql2-promise/mysql",
        environment: "node",
        engine: "mysql",
        scenario: "./scenarios/node/mysql2-promise.js",
      },
      {
        key: "bun-sql/sqlite/bun",
        adapter: "bun-sql/sqlite",
        environment: "bun",
        engine: "sqlite",
        scenario: "./scenarios/bun/bun-sql.js",
      },
      {
        key: "postgresjs/postgresql/deno",
        adapter: "postgresjs/postgresql",
        environment: "deno",
        engine: "postgresql",
        scenario: "./scenarios/deno/postgresjs.js",
      },
    ],
  );
});

test("catalog rendering includes all status classes and matrix dimensions", () => {
  const markdown = renderCatalog();
  assert.match(markdown, /There are exactly 7 engine-qualified adapter variants/);
  assert.match(markdown, /\`verified\`/);
  assert.match(markdown, /\`experimental\`/);
  assert.match(markdown, /\`incompatible\`/);
  assert.match(markdown, /\`not-yet-written\`/);
  for (const adapter of ADAPTER_IDS) {
    assert.ok(markdown.includes(`\`${adapter}\``));
  }
});
