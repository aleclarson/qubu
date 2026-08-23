/** The five runtimes tracked by the combo catalog. */
export const ENVIRONMENT_IDS = [
  "node",
  "bun",
  "deno",
  "cloudflare-workers",
  "browser",
] as const;

export type EnvironmentId = (typeof ENVIRONMENT_IDS)[number];

/** The database engines used by the first seven adapter variants. */
export const DATABASE_ENGINES = ["sqlite", "postgresql", "mysql"] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

/** The four states a candidate adapter/runtime pair can have. */
export const COMBO_STATUSES = [
  "verified",
  "experimental",
  "incompatible",
  "not-yet-written",
] as const;

export type ComboStatus = (typeof COMBO_STATUSES)[number];

/**
 * These IDs include the runtime qualification in the name. That keeps an
 * adapter that has different entry points per runtime from being mistaken for
 * one portable package.
 */
export const ADAPTER_IDS = [
  "node-sqlite",
  "pg-node",
  "mysql2-promise-node",
  "bun-sqlite",
  "postgresjs-deno",
  "d1-workers",
  "pglite-browser",
] as const;

export type AdapterId = (typeof ADAPTER_IDS)[number];

export interface EnvironmentDefinition {
  readonly id: EnvironmentId;
  readonly label: string;
  readonly runtimeCommand: string;
  readonly notes: string;
}

export interface AdapterVariant {
  readonly id: AdapterId;
  readonly label: string;
  readonly packageName: string;
  readonly engine: DatabaseEngine;
  readonly declaredEnvironment: EnvironmentId;
  readonly notes: string;
}

export type ComboKey = `${AdapterId}/${EnvironmentId}`;

export interface ComboCell {
  readonly key: ComboKey;
  readonly adapter: AdapterId;
  readonly environment: EnvironmentId;
  readonly engine: DatabaseEngine;
  readonly status: ComboStatus;
  /** A module specifier is required once a cell becomes verified. */
  readonly scenario?: string;
}

export interface ComboRegistry {
  readonly adapters: readonly AdapterVariant[];
  readonly environments: readonly EnvironmentDefinition[];
  readonly combos: readonly ComboCell[];
}

export const ENVIRONMENTS = [
  {
    id: "node",
    label: "Node.js",
    runtimeCommand: "node",
    notes: "The Node.js launcher uses native dynamic import.",
  },
  {
    id: "bun",
    label: "Bun",
    runtimeCommand: "bun",
    notes: "The Bun launcher is selected by the registry environment.",
  },
  {
    id: "deno",
    label: "Deno",
    runtimeCommand: "deno",
    notes: "The Deno launcher is selected by the registry environment.",
  },
  {
    id: "cloudflare-workers",
    label: "Cloudflare Workers",
    runtimeCommand: "wrangler",
    notes: "The Workers launcher accepts a bundler-provided module loader.",
  },
  {
    id: "browser",
    label: "browser",
    runtimeCommand: "playwright",
    notes: "The browser launcher accepts a browser-bundled module loader.",
  },
] as const satisfies readonly EnvironmentDefinition[];

export const ADAPTER_VARIANTS = [
  {
    id: "node-sqlite",
    label: "node:sqlite",
    packageName: "node:sqlite",
    engine: "sqlite",
    declaredEnvironment: "node",
    notes: "Node's built-in SQLite client.",
  },
  {
    id: "pg-node",
    label: "pg",
    packageName: "pg",
    engine: "postgresql",
    declaredEnvironment: "node",
    notes: "The Node.js PostgreSQL client.",
  },
  {
    id: "mysql2-promise-node",
    label: "mysql2/promise",
    packageName: "mysql2/promise",
    engine: "mysql",
    declaredEnvironment: "node",
    notes: "The promise-based mysql2 client.",
  },
  {
    id: "bun-sqlite",
    label: "Bun.SQL/SQLite",
    packageName: "bun:sqlite",
    engine: "sqlite",
    declaredEnvironment: "bun",
    notes: "Bun's SQL interface backed by SQLite.",
  },
  {
    id: "postgresjs-deno",
    label: "postgres.js",
    packageName: "postgresjs",
    engine: "postgresql",
    declaredEnvironment: "deno",
    notes: "postgres.js loaded in its Deno entry point.",
  },
  {
    id: "d1-workers",
    label: "D1 binding",
    packageName: "cloudflare:d1",
    engine: "sqlite",
    declaredEnvironment: "cloudflare-workers",
    notes: "The D1 binding supplied by a local Wrangler Worker.",
  },
  {
    id: "pglite-browser",
    label: "PGlite",
    packageName: "@electric-sql/pglite",
    engine: "postgresql",
    declaredEnvironment: "browser",
    notes: "PGlite's PostgreSQL-in-WASM browser entry point.",
  },
] as const satisfies readonly AdapterVariant[];

type ComboStatusTable = {
  readonly [Adapter in AdapterId]: {
    readonly [Environment in EnvironmentId]: ComboStatus;
  };
};

/*
 * The target cell for each adapter is deliberately not-yet-written here.
 * Follow-up commits add a scenario and change that one cell to verified. The
 * experimental cells identify plausible cross-runtime experiments, while the
 * incompatible cells are combinations that cannot receive this engine-
 * qualified adapter entry point.
 */
export const COMBO_STATUS_BY_ADAPTER = {
  "node-sqlite": {
    node: "not-yet-written",
    bun: "experimental",
    deno: "experimental",
    "cloudflare-workers": "incompatible",
    browser: "incompatible",
  },
  "pg-node": {
    node: "not-yet-written",
    bun: "experimental",
    deno: "experimental",
    "cloudflare-workers": "incompatible",
    browser: "incompatible",
  },
  "mysql2-promise-node": {
    node: "not-yet-written",
    bun: "experimental",
    deno: "experimental",
    "cloudflare-workers": "incompatible",
    browser: "incompatible",
  },
  "bun-sqlite": {
    node: "incompatible",
    bun: "not-yet-written",
    deno: "incompatible",
    "cloudflare-workers": "incompatible",
    browser: "incompatible",
  },
  "postgresjs-deno": {
    node: "experimental",
    bun: "experimental",
    deno: "not-yet-written",
    "cloudflare-workers": "experimental",
    browser: "incompatible",
  },
  "d1-workers": {
    node: "incompatible",
    bun: "incompatible",
    deno: "incompatible",
    "cloudflare-workers": "not-yet-written",
    browser: "incompatible",
  },
  "pglite-browser": {
    node: "experimental",
    bun: "experimental",
    deno: "experimental",
    "cloudflare-workers": "experimental",
    browser: "not-yet-written",
  },
} as const satisfies ComboStatusTable;

/** Join a variant and environment into the registry's stable key. */
export function comboKey(adapter: AdapterId, environment: EnvironmentId): ComboKey {
  return `${adapter}/${environment}`;
}

function makeComboCells(): readonly ComboCell[] {
  return ADAPTER_VARIANTS.flatMap((adapter) =>
    ENVIRONMENTS.map((environment) => ({
      key: comboKey(adapter.id, environment.id),
      adapter: adapter.id,
      environment: environment.id,
      engine: adapter.engine,
      status: COMBO_STATUS_BY_ADAPTER[adapter.id][environment.id],
    })),
  );
}

/**
 * Validate and return a registry. Keeping this check at the boundary makes a
 * hand-edited status table fail immediately instead of silently changing the
 * CI matrix or catalog output.
 */
export interface RegistryValidationOptions {
  /** Require the published seven-by-five catalog shape. */
  readonly exactCatalog?: boolean;
}

export function defineRegistry(
  registry: ComboRegistry,
  options: RegistryValidationOptions = {},
): ComboRegistry {
  if (options.exactCatalog && registry.adapters.length !== ADAPTER_IDS.length) {
    throw new Error(`Expected ${ADAPTER_IDS.length} adapter variants.`);
  }
  if (options.exactCatalog && registry.environments.length !== ENVIRONMENT_IDS.length) {
    throw new Error(`Expected ${ENVIRONMENT_IDS.length} environments.`);
  }

  const adapterIds = new Set<AdapterId>();
  for (const adapter of registry.adapters) {
    if (adapterIds.has(adapter.id)) {
      throw new Error(`Duplicate adapter variant: ${adapter.id}`);
    }
    adapterIds.add(adapter.id);
  }

  const environmentIds = new Set<EnvironmentId>();
  for (const environment of registry.environments) {
    if (environmentIds.has(environment.id)) {
      throw new Error(`Duplicate environment: ${environment.id}`);
    }
    environmentIds.add(environment.id);
  }

  const expectedKeys = new Set(
    registry.adapters.flatMap((adapter) =>
      registry.environments.map((environment) => comboKey(adapter.id, environment.id)),
    ),
  );
  if (registry.combos.length !== expectedKeys.size) {
    throw new Error(`Expected ${expectedKeys.size} combo cells.`);
  }

  const seenKeys = new Set<ComboKey>();
  for (const cell of registry.combos) {
    if (!expectedKeys.has(cell.key)) {
      throw new Error(`Combo cell is not in the registry matrix: ${cell.key}`);
    }
    if (seenKeys.has(cell.key)) {
      throw new Error(`Duplicate combo cell: ${cell.key}`);
    }
    seenKeys.add(cell.key);

    const adapter = registry.adapters.find((candidate) => candidate.id === cell.adapter);
    if (!adapter) {
      throw new Error(`Combo cell references an unknown adapter: ${cell.adapter}`);
    }
    if (adapter.engine !== cell.engine) {
      throw new Error(`Engine mismatch for ${cell.key}.`);
    }
    if (cell.status === "verified" && !cell.scenario) {
      throw new Error(`Verified combo ${cell.key} must declare a scenario module.`);
    }
  }

  if (seenKeys.size !== expectedKeys.size) {
    throw new Error("The combo registry does not cover every adapter/environment pair.");
  }
  return registry;
}

export const comboRegistry = defineRegistry({
  adapters: ADAPTER_VARIANTS,
  environments: ENVIRONMENTS,
  combos: makeComboCells(),
}, { exactCatalog: true });

/** A short alias for consumers that treat the catalog as the source of truth. */
export const registry = comboRegistry;

export function findCombo(
  currentRegistry: ComboRegistry,
  adapter: AdapterId,
  environment: EnvironmentId,
): ComboCell {
  const key = comboKey(adapter, environment);
  const cell = currentRegistry.combos.find((candidate) => candidate.key === key);
  if (!cell) {
    throw new Error(`Unknown combo cell: ${key}`);
  }
  return cell;
}

export function statusCounts(
  currentRegistry: ComboRegistry = comboRegistry,
): Readonly<Record<ComboStatus, number>> {
  const counts: Record<ComboStatus, number> = {
    verified: 0,
    experimental: 0,
    incompatible: 0,
    "not-yet-written": 0,
  };
  for (const combo of currentRegistry.combos) {
    counts[combo.status] += 1;
  }
  return counts;
}
