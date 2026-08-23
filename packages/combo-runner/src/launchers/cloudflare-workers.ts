import type { RuntimeLauncher, ScenarioLoader } from "./runtime.js";
import { createRuntimeLauncher } from "./runtime.js";

export function createCloudflareWorkersLauncher(
  loader?: ScenarioLoader,
): RuntimeLauncher {
  return createRuntimeLauncher("cloudflare-workers", loader);
}

export const cloudflareWorkersLauncher = createCloudflareWorkersLauncher();
