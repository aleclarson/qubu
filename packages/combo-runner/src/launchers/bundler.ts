import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

export interface BundleOptions {
  readonly entryPoint: string;
  readonly outfile: string;
  readonly platform: "browser" | "neutral";
  readonly format: "esm" | "iife";
  readonly globalName?: string;
}

function qubuDistPath(): string {
  const packageJson = require.resolve("qubu/package.json");
  return join(dirname(packageJson), "dist/index.mjs");
}

function pgliteDistPath(): string {
  return dirname(require.resolve("@electric-sql/pglite"));
}

function pgliteBrowserEntry(): string {
  return join(pgliteDistPath(), "index.js");
}

/** Write a generated runtime entrypoint and bundle it with the parent Qubu build. */
export async function bundleRuntimeEntry(
  source: string,
  options: BundleOptions,
): Promise<string> {
  await mkdir(dirname(options.entryPoint), { recursive: true });
  await writeFile(options.entryPoint, source, "utf8");
  await build({
    absWorkingDir: dirname(options.entryPoint),
    entryPoints: [options.entryPoint],
    outfile: options.outfile,
    bundle: true,
    format: options.format,
    platform: options.platform,
    target: "es2022",
    conditions: ["browser", "import", "default"],
    alias: {
      qubu: qubuDistPath(),
      "@electric-sql/pglite": pgliteBrowserEntry(),
    },
    globalName: options.globalName,
    logLevel: "silent",
  });
  return options.outfile;
}

/**
 * PGlite's browser build resolves its WASM and filesystem bundle next to the
 * generated JavaScript module. Copy those immutable package assets beside the
 * browser bundle so page fetches stay local and deterministic.
 */
export async function copyPgliteBrowserAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const sourceDirectory = pgliteDistPath();
  for (const asset of ["pglite.wasm", "initdb.wasm", "pglite.data"] as const) {
    await copyFile(join(sourceDirectory, asset), join(directory, asset));
  }
}
