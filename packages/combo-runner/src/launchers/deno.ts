import type { RuntimeLauncher, ScenarioLoader } from "./runtime.js";
import { createRuntimeLauncher } from "./runtime.js";

export function createDenoLauncher(loader?: ScenarioLoader): RuntimeLauncher {
  return createRuntimeLauncher("deno", loader);
}

export const denoLauncher = createDenoLauncher();
