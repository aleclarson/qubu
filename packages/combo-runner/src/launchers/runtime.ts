import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
 * JSON-safe context passed to a native runtime child process. The runner keeps
 * the live connection and only sends the resource locator across the process
 * boundary.
 */
export interface NativeLaunchPayload {
  readonly combo: ComboCell;
  readonly scenario: string;
  readonly database: {
    readonly engine: ProvisionedDatabase["engine"];
    readonly connectionString?: string;
    readonly metadata?: Readonly<Record<string, string>>;
  };
}

export interface NativeRuntimeLauncherOptions {
  /** Executable name or path, defaulting to the declared runtime. */
  readonly command?: string;
  /** Arguments placed before the worker and payload arguments. */
  readonly commandArguments?: readonly string[];
  /** Compiled worker entry point. Defaults to this package's native worker. */
  readonly worker?: URL;
  /** Working directory used by the child runtime. */
  readonly cwd?: string;
  /** Injectable process factory for deterministic launcher tests. */
  readonly spawnProcess?: typeof spawn;
}

function resolveCompiledScenario(specifier: ModuleSpecifier): string {
  if (specifier instanceof URL) {
    return specifier.href;
  }
  if (specifier.startsWith(".")) {
    return new URL(`../${specifier.slice(2)}`, import.meta.url).href;
  }
  return specifier;
}

function collectOutput(stream: NodeJS.ReadableStream | null): {
  readonly text: () => string;
} {
  let output = "";
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    output += chunk;
  });
  return { text: () => output };
}

function nativePayload(request: LaunchRequest): NativeLaunchPayload {
  if (!request.database.connectionString) {
    throw new Error(
      `Native ${request.combo.environment} scenarios require a connection string for ${request.combo.key}.`,
    );
  }
  return {
    combo: request.combo,
    scenario: resolveCompiledScenario(request.scenario),
    database: {
      engine: request.database.engine,
      connectionString: request.database.connectionString,
      metadata: {
        ...request.database.metadata,
        qubuModule: new URL("../../../../../dist/index.mjs", import.meta.url).href,
      },
    },
  };
}

async function launchNativeProcess(
  request: LaunchRequest,
  options: NativeRuntimeLauncherOptions,
): Promise<void> {
  if (request.signal?.aborted) {
    throw request.signal.reason ?? new Error("Native scenario launch was aborted.");
  }

  const payload = nativePayload(request);
  const worker = options.worker ?? new URL("./native-worker.js", import.meta.url);
  const command = options.command ?? request.combo.environment;
  const args = [
    ...(options.commandArguments ?? []),
    fileURLToPath(worker),
    payload.scenario,
    JSON.stringify(payload),
  ];
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(command, args, {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    signal: request.signal,
  });
  const stdout = collectOutput(child.stdout);
  const stderr = collectOutput(child.stderr);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.once("error", fail);
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const details = [stdout.text().trim(), stderr.text().trim()]
        .filter(Boolean)
        .join("\n");
      const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(
        new Error(
          `Native ${request.combo.environment} scenario ${request.combo.key} failed with ${status}.${
            details ? `\n${details}` : ""
          }`,
        ),
      );
    });
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") {
      throw request.signal?.reason ?? error;
    }
    throw error;
  });
}

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

/** Launch a scenario in a real Bun, Deno, or other process runtime. */
export function createNativeRuntimeLauncher(
  environment: EnvironmentId,
  options: NativeRuntimeLauncherOptions = {},
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
      await launchNativeProcess(request, options);
    },
  };
}
