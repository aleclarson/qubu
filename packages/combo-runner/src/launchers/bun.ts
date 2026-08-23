import type { RuntimeLauncher, NativeRuntimeLauncherOptions } from "./runtime.js";
import { createNativeRuntimeLauncher } from "./runtime.js";

export function createBunLauncher(
  options: NativeRuntimeLauncherOptions = {},
): RuntimeLauncher {
  return createNativeRuntimeLauncher("bun", {
    ...options,
    command: options.command ?? process.env.QUBU_BUN_BIN ?? "bun",
  });
}

export const bunLauncher = createBunLauncher();
