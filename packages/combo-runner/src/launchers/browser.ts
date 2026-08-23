import type { RuntimeLauncher, ScenarioLoader } from "./runtime.js";
import { createRuntimeLauncher } from "./runtime.js";

export function createBrowserLauncher(loader?: ScenarioLoader): RuntimeLauncher {
  return createRuntimeLauncher("browser", loader);
}

export const browserLauncher = createBrowserLauncher();
