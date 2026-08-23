import { appendFile, readFile, writeFile } from "node:fs/promises";
import { renderCatalog } from "./catalog-markdown.js";
import {
  ADAPTER_IDS,
  ENVIRONMENT_IDS,
  type AdapterId,
  type EnvironmentId,
} from "./catalog.js";
import {
  browserLauncher,
  bunLauncher,
  cloudflareWorkersLauncher,
  denoLauncher,
  nodeLauncher,
} from "./launchers/index.js";
import { comboProvisioners } from "./node-provisioners.js";
import { runCombo, selectCiMatrix } from "./runner.js";

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  combo-runner catalog --write <path>",
      "  combo-runner catalog --check <path>",
      "  combo-runner ci-matrix [--github-output <path>]",
      "  combo-runner run --adapter <id> --environment <id>",
    ].join("\n"),
  );
}

function requiredArgument(args: readonly string[], index: number): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

async function catalogCommand(args: readonly string[]): Promise<void> {
  const mode = args[0];
  const path = requiredArgument(args, 1);
  const output = `${renderCatalog().trimEnd()}\n`;

  if (mode === "--write") {
    await writeFile(path, output, "utf8");
    return;
  }
  if (mode === "--check") {
    let existing: string;
    try {
      existing = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`Cannot read generated catalog at ${path}.`, { cause: error });
    }
    if (existing !== output) {
      throw new Error(`Generated catalog is stale. Run pnpm catalog:generate (${path}).`);
    }
    return;
  }
  usage();
}

async function matrixCommand(args: readonly string[]): Promise<void> {
  const matrix = { include: selectCiMatrix() };
  const serialized = JSON.stringify(matrix);
  const outputIndex = args.indexOf("--github-output");
  if (outputIndex !== -1) {
    const outputPath = requiredArgument(args, outputIndex + 1);
    await appendFile(
      outputPath,
      `matrix=${serialized}\nhas_verified=${matrix.include.length > 0 ? "true" : "false"}\n`,
      "utf8",
    );
  }
  process.stdout.write(`${serialized}\n`);
}

function flagValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  return requiredArgument(args, index + 1);
}

function parseAdapter(value: string): AdapterId {
  if (!ADAPTER_IDS.includes(value as AdapterId)) {
    throw new Error(`Unknown adapter variant: ${value}`);
  }
  return value as AdapterId;
}

function parseEnvironment(value: string): EnvironmentId {
  if (!ENVIRONMENT_IDS.includes(value as EnvironmentId)) {
    throw new Error(`Unknown environment: ${value}`);
  }
  return value as EnvironmentId;
}

async function runCommand(args: readonly string[]): Promise<void> {
  const adapter = parseAdapter(flagValue(args, "--adapter"));
  const environment = parseEnvironment(flagValue(args, "--environment"));
  await runCombo(
    { adapter, environment },
    {
      launchers: {
        node: nodeLauncher,
        bun: bunLauncher,
        deno: denoLauncher,
        "cloudflare-workers": cloudflareWorkersLauncher,
        browser: browserLauncher,
      },
      provisioners: comboProvisioners,
    },
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "catalog") {
    await catalogCommand(args);
    return;
  }
  if (command === "ci-matrix") {
    await matrixCommand(args);
    return;
  }
  if (command === "run") {
    await runCommand(args);
    return;
  }
  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
