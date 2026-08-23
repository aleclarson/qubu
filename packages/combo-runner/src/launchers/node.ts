import type { RuntimeLauncher, ScenarioLoader } from "./runtime.js";
import { createRuntimeLauncher, dynamicImport, type ModuleSpecifier } from "./runtime.js";

/**
 * Resolve source-relative registry paths from the compiled package root. A
 * native `import("./scenarios/node/pg.js")` inside launchers/runtime.js would
 * incorrectly look under `dist/launchers`.
 */
export function resolveNodeScenario(specifier: ModuleSpecifier): ModuleSpecifier {
  if (specifier instanceof URL || !specifier.startsWith(".")) {
    return specifier;
  }
  return new URL(`../${specifier.slice(2)}`, import.meta.url);
}

export const nodeScenarioLoader: ScenarioLoader = (specifier) =>
  dynamicImport(resolveNodeScenario(specifier));

export function createNodeLauncher(loader: ScenarioLoader = nodeScenarioLoader): RuntimeLauncher {
  return createRuntimeLauncher("node", loader);
}

export const nodeLauncher = createNodeLauncher();
