import type { RuntimeLauncher, ScenarioLoader } from "./runtime.js";
import { createRuntimeLauncher } from "./runtime.js";

export function createNodeLauncher(loader?: ScenarioLoader): RuntimeLauncher {
  return createRuntimeLauncher("node", loader);
}

export const nodeLauncher = createNodeLauncher();
