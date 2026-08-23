import type { EnvironmentId, ComboCell } from "../catalog.js";
import {
  isVerificationModule,
  type ProvisionedDatabase,
  type VerificationContext,
} from "../contract.js";

export type ModuleSpecifier = string | URL;
export type ScenarioLoader = (specifier: ModuleSpecifier) => Promise<unknown>;

export interface LaunchRequest<Connection = unknown> {
  readonly combo: ComboCell;
  readonly database: ProvisionedDatabase<Connection>;
  readonly scenario: ModuleSpecifier;
  readonly signal?: AbortSignal;
}

export interface RuntimeLauncher {
  readonly environment: EnvironmentId;
  launch(request: LaunchRequest): Promise<void>;
}

export const dynamicImport: ScenarioLoader = (specifier) => import(String(specifier));

/**
 * Build a launcher for a named runtime. The default loader uses native ESM
 * dynamic import. Workers and browser callers can inject a bundler-aware
 * loader while keeping the same runner contract.
 */
export function createRuntimeLauncher(
  environment: EnvironmentId,
  loadScenario: ScenarioLoader = dynamicImport,
): RuntimeLauncher {
  return {
    environment,
    async launch(request) {
      if (request.combo.environment !== environment) {
        throw new Error(
          `Launcher ${environment} cannot run ${request.combo.key}; ` +
            `the registry declares ${request.combo.environment}.`,
        );
      }

      const imported = await loadScenario(request.scenario);
      if (!isVerificationModule(imported)) {
        throw new Error(
          `Scenario ${String(request.scenario)} must export an async verify function.`,
        );
      }

      const context: VerificationContext = {
        combo: request.combo,
        database: request.database,
        signal: request.signal,
      };
      await imported.verify(context);
    },
  };
}
