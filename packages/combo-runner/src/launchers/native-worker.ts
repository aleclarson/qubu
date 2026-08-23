import type { NativeLaunchPayload } from "./runtime.js";
import { isVerificationModule, type ProvisionedDatabase } from "../contract.js";

interface RuntimeGlobals {
  readonly Bun?: { readonly argv: readonly string[] };
  readonly Deno?: { readonly args: readonly string[] };
}

function runtimeArguments(): readonly string[] {
  const globals = globalThis as RuntimeGlobals;
  if (globals.Deno) {
    return globals.Deno.args;
  }
  if (globals.Bun) {
    return globals.Bun.argv.slice(2);
  }
  throw new Error("The native scenario worker must run in Bun or Deno.");
}

function readPayload(): NativeLaunchPayload {
  const [scenario, serialized] = runtimeArguments();
  if (!scenario || !serialized) {
    throw new Error("Native scenario worker requires a scenario and JSON payload.");
  }
  const payload = JSON.parse(serialized) as NativeLaunchPayload;
  if (payload.scenario !== scenario) {
    throw new Error("Native scenario payload and worker arguments disagree.");
  }
  return payload;
}

async function main(): Promise<void> {
  const payload = readPayload();
  const imported = await import(payload.scenario);
  if (!isVerificationModule(imported)) {
    throw new Error(`Scenario ${payload.scenario} must export an async verify function.`);
  }

  const database: ProvisionedDatabase<undefined> = {
    engine: payload.database.engine,
    connection: undefined,
    connectionString: payload.database.connectionString,
    metadata: payload.database.metadata,
    async dispose() {},
  };
  await imported.verify({
    combo: payload.combo,
    database,
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  throw error;
}
