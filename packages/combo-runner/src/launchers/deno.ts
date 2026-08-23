import type { NativeRuntimeLauncherOptions, RuntimeLauncher } from "./runtime.js";
import { createNativeRuntimeLauncher } from "./runtime.js";

export function createDenoLauncher(
  options: NativeRuntimeLauncherOptions = {},
): RuntimeLauncher {
  return createNativeRuntimeLauncher("deno", {
    ...options,
    command: options.command ?? process.env.QUBU_DENO_BIN ?? "deno",
    commandArguments: options.commandArguments ?? [
      "run",
      "--no-check",
      "--allow-net",
      "--allow-read",
      "--allow-env",
      "--node-modules-dir=manual",
    ],
  });
}

export const denoLauncher = createDenoLauncher();
