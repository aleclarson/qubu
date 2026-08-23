import {
  comboRegistry,
  statusCounts,
  type ComboRegistry,
  type ComboStatus,
  type EnvironmentId,
} from "./catalog.js";

const STATUS_DESCRIPTIONS: Readonly<Record<ComboStatus, string>> = {
  verified: "A scenario exports `verify`, runs in the declared runtime, and completes a live round trip.",
  experimental: "The pairing may be useful, but it is not part of the verified CI set.",
  incompatible: "The engine-qualified adapter entry point cannot run in this environment.",
  "not-yet-written": "This is a planned pairing with no scenario module yet.",
};

const environmentColumns: readonly EnvironmentId[] = [
  "node",
  "bun",
  "deno",
  "cloudflare-workers",
  "browser",
];

function statusCountsTable(registry: ComboRegistry): string {
  const counts = statusCounts(registry);
  return [
    "| Status | Cells | Meaning |",
    "| --- | ---: | --- |",
    ...Object.entries(STATUS_DESCRIPTIONS).map(
      ([status, description]) =>
        `| \`${status}\` | ${counts[status as ComboStatus]} | ${description} |`,
    ),
  ].join("\n");
}

function adapterTable(registry: ComboRegistry): string {
  return [
    "| ID | Adapter | Engine | Declared runtime |",
    "| --- | --- | --- | --- |",
    ...registry.adapters.map((adapter) => {
      const environment = registry.environments.find(
        (candidate) => candidate.id === adapter.declaredEnvironment,
      );
      return `| \`${adapter.id}\` | ${adapter.label} | ${adapter.engine} | ${environment?.label ?? adapter.declaredEnvironment} |`;
    }),
  ].join("\n");
}

function matrixTable(registry: ComboRegistry): string {
  const labels = new Map(registry.environments.map((environment) => [environment.id, environment.label]));
  return [
    `| Adapter | ${environmentColumns.map((environment) => labels.get(environment) ?? environment).join(" | ")} |`,
    `| --- | ${environmentColumns.map(() => "---").join(" | ")} |`,
    ...registry.adapters.map((adapter) => {
      const statuses = environmentColumns.map((environment) => {
        const cell = registry.combos.find(
          (candidate) => candidate.adapter === adapter.id && candidate.environment === environment,
        );
        return `\`${cell?.status ?? "missing"}\``;
      });
      return `| \`${adapter.id}\` | ${statuses.join(" | ")} |`;
    }),
  ].join("\n");
}

function verificationTargets(registry: ComboRegistry): string {
  const targets = registry.combos.filter(
    (combo) => combo.status === "verified" || combo.status === "not-yet-written",
  );
  return [
    "| Adapter | Runtime | Status | Scenario |",
    "| --- | --- | --- | --- |",
    ...targets.map((combo) => {
      const environment = registry.environments.find(
        (candidate) => candidate.id === combo.environment,
      );
      return `| \`${combo.adapter}\` | ${environment?.label ?? combo.environment} | \`${combo.status}\` | ${combo.scenario ? `\`${combo.scenario}\`` : "pending"} |`;
    }),
  ].join("\n");
}

export function renderCatalog(registry: ComboRegistry = comboRegistry): string {
  return `# Combo catalog

> This page is generated from \`packages/combo-runner/src/catalog.ts\`. Edit the typed registry, then run \`pnpm catalog:generate\`.

The combo library tracks one database-client adapter variant against each
runtime where someone might try to execute it. A combo is eligible for CI only
when its cell is \`verified\` and its scenario exports an async \`verify\`
function.

## Runtime flow

The registry supplies both the CI selection and the runtime/database choices.
The scenario owns schema setup, test data, and the Qubu query. The runner owns
the database lifetime.

\`\`\`mermaid
flowchart LR
  registry[Typed registry] --> selection[CI selection]
  selection --> launcher[Environment launcher]
  runner[Shared runner] --> provisioner[Disposable provisioner]
  provisioner --> launcher
  launcher --> scenario[Scenario verify function]
\`\`\`

## Adapter variants

There are exactly ${registry.adapters.length} engine-qualified adapter variants
and ${registry.environments.length} environments, so the matrix contains
${registry.combos.length} cells.

${adapterTable(registry)}

## Status counts

${statusCountsTable(registry)}

## Complete matrix

Every adapter/environment pair appears below. The status is a planning fact,
not a promise that the runtime can load a package without a scenario.

${matrixTable(registry)}

## Verification targets

The three Node.js targets plus Bun and Deno have live scenarios. The Workers
and browser targets stay pending for their native-runtime commit. Incompatible
and experimental cells stay in the complete matrix so a new scenario requires
an explicit status change.

${verificationTargets(registry)}

## Commands

Install the workspace and run its deterministic checks:

\`\`\`bash
pnpm install
pnpm check
\`\`\`

Regenerate this page after a registry edit:

\`\`\`bash
pnpm catalog:generate
\`\`\`

Print the JSON matrix that CI will execute. This commit selects five scenarios,
including Bun and Deno:

\`\`\`bash
pnpm ci:matrix
\`\`\`

## Adding a verified scenario

Add a module under \`packages/combo-runner/src/scenarios/\` that exports one
async \`verify(context)\` function. The function should prepare its own small
schema and data, execute a bound Qubu query, assert the returned rows, and
clean up scenario-owned objects. Then add its module specifier to the target
cell, change that cell to \`verified\`, and provide the matching launcher and
provisioner in the CI runtime.

The Node launcher imports a scenario in-process. Bun and Deno launch a
compiled worker in the native runtime and pass it a JSON-safe connection
locator. Workers and browser launchers keep the same contract for a later
bundler-backed commit.
`;
}
