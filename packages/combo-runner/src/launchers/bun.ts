import type { RuntimeLauncher, ScenarioLoader } from "./runtime.js";
import { createRuntimeLauncher } from "./runtime.js";

export function createBunLauncher(loader?: ScenarioLoader): RuntimeLauncher {
  return createRuntimeLauncher("bun", loader);
}

export const bunLauncher = createBunLauncher();
