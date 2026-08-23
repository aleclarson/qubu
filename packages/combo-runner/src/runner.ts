import {
  comboRegistry,
  findCombo,
  type AdapterId,
  type ComboCell,
  type ComboRegistry,
  type DatabaseEngine,
  type EnvironmentId,
} from "./catalog.js";
import type { DatabaseProvisioner, ProvisionRequest } from "./provisioners.js";
import type { LaunchRequest, RuntimeLauncher } from "./launchers/runtime.js";

export interface ComboSelector {
  readonly adapter: AdapterId;
  readonly environment: EnvironmentId;
}

export interface RunnerDependencies {
  readonly registry?: ComboRegistry;
  readonly launchers: Readonly<Partial<Record<EnvironmentId, RuntimeLauncher>>>;
  readonly provisioners: Readonly<Partial<Record<DatabaseEngine, DatabaseProvisioner>>>;
}

export interface RunOptions {
  readonly runId?: string;
  readonly signal?: AbortSignal;
}

export interface VerificationRun {
  readonly combo: ComboCell;
  readonly runId: string;
  readonly durationMs: number;
}

export interface CiMatrixEntry {
  readonly key: string;
  readonly adapter: AdapterId;
  readonly environment: EnvironmentId;
  readonly engine: DatabaseEngine;
  readonly scenario: string;
}

function requireScenario(combo: ComboCell): string {
  if (!combo.scenario) {
    throw new Error(`Verified combo ${combo.key} must declare a scenario module.`);
  }
  return combo.scenario;
}

/** Return the only cells that CI is allowed to execute. */
export function selectVerifiedCombos(
  registry: ComboRegistry = comboRegistry,
): readonly ComboCell[] {
  const selected = registry.combos.filter((combo) => combo.status === "verified");
  for (const combo of selected) {
    requireScenario(combo);
  }
  return selected;
}

export function selectCiMatrix(
  registry: ComboRegistry = comboRegistry,
): readonly CiMatrixEntry[] {
  return selectVerifiedCombos(registry).map((combo) => ({
    key: combo.key,
    adapter: combo.adapter,
    environment: combo.environment,
    engine: combo.engine,
    scenario: requireScenario(combo),
  }));
}

function makeRunId(combo: ComboCell): string {
  return `${combo.key.replaceAll("/", "-")}-${Date.now()}`;
}

function requireLauncher(
  dependencies: RunnerDependencies,
  environment: EnvironmentId,
): RuntimeLauncher {
  const launcher = dependencies.launchers[environment];
  if (!launcher) {
    throw new Error(`No ${environment} launcher is configured.`);
  }
  return launcher;
}

function requireProvisioner(
  dependencies: RunnerDependencies,
  engine: DatabaseEngine,
): DatabaseProvisioner {
  const provisioner = dependencies.provisioners[engine];
  if (!provisioner) {
    throw new Error(`No ${engine} database provisioner is configured.`);
  }
  return provisioner;
}

/** Provision, import, verify, and dispose one selected scenario. */
export async function runCombo(
  selector: ComboSelector,
  dependencies: RunnerDependencies,
  options: RunOptions = {},
): Promise<VerificationRun> {
  const registry = dependencies.registry ?? comboRegistry;
  const combo = findCombo(registry, selector.adapter, selector.environment);
  if (combo.status !== "verified") {
    throw new Error(
      `Combo ${combo.key} is ${combo.status}; only verified cells can run in CI.`,
    );
  }

  const launcher = requireLauncher(dependencies, combo.environment);
  const provisioner = requireProvisioner(dependencies, combo.engine);
  const runId = options.runId ?? makeRunId(combo);
  const request: ProvisionRequest = {
    combo,
    runId,
    signal: options.signal,
  };
  let database: Awaited<ReturnType<DatabaseProvisioner["provision"]>> | undefined;
  const startedAt = Date.now();

  try {
    database = await provisioner.provision(request);
    const launchRequest: LaunchRequest = {
      combo,
      database,
      scenario: requireScenario(combo),
      signal: options.signal,
    };
    await launcher.launch(launchRequest);
  } finally {
    await database?.dispose();
  }

  return {
    combo,
    runId,
    durationMs: Date.now() - startedAt,
  };
}

/** Run the selected cells in registry order, keeping databases isolated. */
export async function runVerifiedCombos(
  dependencies: RunnerDependencies,
  options: RunOptions = {},
): Promise<readonly VerificationRun[]> {
  const registry = dependencies.registry ?? comboRegistry;
  const results: VerificationRun[] = [];
  for (const combo of selectVerifiedCombos(registry)) {
    results.push(
      await runCombo(
        { adapter: combo.adapter, environment: combo.environment },
        dependencies,
        options,
      ),
    );
  }
  return results;
}
