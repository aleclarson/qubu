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

test("planned target cells remain unwritten until scenarios exist", () => {
  const targetCells = [
    ["node-sqlite", "node"],
    ["pg-node", "node"],
    ["mysql2-promise-node", "node"],
    ["bun-sqlite", "bun"],
    ["postgresjs-deno", "deno"],
    ["d1-workers", "cloudflare-workers"],
    ["pglite-browser", "browser"],
  ] as const;

  for (const [adapter, environment] of targetCells) {
    assert.equal(findCombo(comboRegistry, adapter, environment).status, "not-yet-written");
  }
  assert.equal(statusCounts().verified, 0);
});

test("CI selection contains only verified scenarios", () => {
  assert.deepEqual(selectCiMatrix(), []);
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
