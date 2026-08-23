import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { LaunchRequest, RuntimeLauncher } from "./runtime.js";
import { resolveNodeScenario } from "./node.js";
import { bundleRuntimeEntry } from "./bundler.js";

const WORKER_BINDING = "QUBU_COMBO_DB";
const COMPATIBILITY_DATE = "2025-01-01";
const require = createRequire(import.meta.url);

type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CloudflareWorkersLauncherOptions {
  /** Wrangler executable name or path. */
  readonly command?: string;
  /** Injectable child-process factory for launcher boundary tests. */
  readonly spawnProcess?: typeof spawn;
  /** Injectable fetch implementation for launcher boundary tests. */
  readonly fetchImpl?: FetchImpl;
  /** Injectable free-port allocator for launcher boundary tests. */
  readonly allocatePort?: () => Promise<number>;
  /** Injectable temporary-directory factory for launcher boundary tests. */
  readonly createTempDirectory?: () => Promise<string>;
  /** Injectable bundler for launcher boundary tests. */
  readonly buildWorker?: (request: LaunchRequest, directory: string) => Promise<string>;
  /** Maximum time to wait for Wrangler's local server to listen. */
  readonly startupTimeoutMs?: number;
}

interface CapturedOutput {
  text(): string;
}

function captureOutput(stream: NodeJS.ReadableStream | null): CapturedOutput {
  let output = "";
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk: string) => {
    output += chunk;
  });
  return { text: () => output };
}

function sanitize(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-40) || "run"
  );
}

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) {
    throw new Error("Could not allocate a local Wrangler port.");
  }
  return port;
}

function workerSource(request: LaunchRequest): string {
  const scenario = resolveNodeScenario(request.scenario);
  if (!(scenario instanceof URL) || scenario.protocol !== "file:") {
    throw new Error(`Workers scenarios must resolve to a local file: ${String(request.scenario)}`);
  }
  return `
import { verify } from ${JSON.stringify(fileURLToPath(scenario))};

const combo = ${JSON.stringify(request.combo)};

function errorText(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") {
      return new Response("ok");
    }
    if (pathname !== "/run") {
      return new Response("not found", { status: 404 });
    }
    try {
      await verify({
        combo,
        database: {
          engine: "sqlite",
          connection: env.${WORKER_BINDING},
          metadata: { binding: ${JSON.stringify(WORKER_BINDING)} },
          async dispose() {},
        },
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, error: errorText(error) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;
}

async function buildWorker(request: LaunchRequest, directory: string): Promise<string> {
  return bundleRuntimeEntry(workerSource(request), {
    entryPoint: join(directory, "worker-entry.mjs"),
    outfile: join(directory, "worker.mjs"),
    platform: "neutral",
    format: "esm",
  });
}

function wranglerConfig(workerPath: string, directory: string, runId: string): string {
  const databaseId = randomUUID();
  return JSON.stringify(
    {
      name: `qubu-combo-${sanitize(runId)}`,
      main: relative(directory, workerPath),
      compatibility_date: COMPATIBILITY_DATE,
      d1_databases: [
        {
          binding: WORKER_BINDING,
          database_name: `qubu-combo-${sanitize(runId)}`,
          database_id: databaseId,
        },
      ],
    },
    null,
    2,
  );
}

interface ChildOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: Error;
}

function childFailure(
  key: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  stdout: CapturedOutput,
  stderr: CapturedOutput,
): Error {
  const details = [stdout.text().trim(), stderr.text().trim()].filter(Boolean).join("\n");
  const status = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
  return new Error(
    `Cloudflare Workers scenario ${key} failed with ${status}.${details ? `\n${details}` : ""}`,
  );
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  }
  if (
    typeof child.kill !== "function" ||
    child.killed ||
    child.exitCode !== null ||
    child.signalCode !== null &&
    child.signalCode !== undefined
  ) {
    return false;
  }
  child.kill(signal);
  return true;
}

async function terminate(
  child: ChildProcess,
  close: Promise<ChildOutcome>,
): Promise<void> {
  if (typeof child.kill !== "function" && child.pid === undefined) {
    return;
  }
  signalProcessTree(child, "SIGTERM");
  await Promise.race([close, delay(1000)]);
  if (child.exitCode === null) {
    signalProcessTree(child, "SIGKILL");
    await Promise.race([close, delay(1000)]);
  }
}

function closeEvent(
  child: ChildProcess,
): Promise<ChildOutcome> {
  return new Promise((resolve) => {
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) =>
      resolve({ code, signal }),
    );
    child.once("error", (error: Error) => resolve({ code: null, signal: null, error }));
  });
}

async function waitForHealth(
  url: string,
  childExit: Promise<ChildOutcome>,
  stdout: CapturedOutput,
  stderr: CapturedOutput,
  fetchImpl: FetchImpl,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Workers scenario launch was aborted.");
    }
    const exited = await Promise.race([
      childExit.then(({ code, signal: childSignal, error }) => ({ code, signal: childSignal, error })),
      delay(0).then(() => undefined),
    ]);
    if (exited) {
      if (exited.error) {
        throw exited.error;
      }
      throw childFailure("startup", exited.code, exited.signal, stdout, stderr);
    }
    try {
      const response = await fetchImpl(url, { signal });
      if (response.ok) {
        return;
      }
    } catch {
      // Wrangler may still be compiling or binding the local D1 database.
    }
    await delay(100, undefined, signal ? { signal } : undefined).catch((error: unknown) => {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      throw error;
    });
  }
  throw new Error(
    `Cloudflare Workers server did not become ready within ${timeoutMs}ms.${stderr.text() ? `\n${stderr.text().trim()}` : ""}`,
  );
}

async function runWorker(
  request: LaunchRequest,
  options: CloudflareWorkersLauncherOptions,
): Promise<void> {
  if (request.signal?.aborted) {
    throw request.signal.reason ?? new Error("Workers scenario launch was aborted.");
  }

  const createTempDirectory =
    options.createTempDirectory ?? (() => mkdtemp(join(tmpdir(), "qubu-combo-workers-")));
  const directory = await createTempDirectory();
  let child: ChildProcess | undefined;
  let childExit: Promise<ChildOutcome> | undefined;
  try {
    const workerPath = await (options.buildWorker ?? buildWorker)(request, directory);
    const configPath = join(directory, "wrangler.json");
    await writeFile(configPath, wranglerConfig(workerPath, directory, request.combo.key), "utf8");
    const port = await (options.allocatePort ?? allocatePort)();
    const configuredCommand = options.command ?? process.env.QUBU_WRANGLER_BIN;
    const command = configuredCommand ?? process.execPath;
    const args = [
      ...(configuredCommand ? [] : [require.resolve("wrangler")]),
      "dev",
      "--config",
      configPath,
      "--local",
      "--no-bundle",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      join(directory, "state"),
      "--show-interactive-dev-session=false",
    ];
    child = (options.spawnProcess ?? spawn)(command, args, {
      cwd: directory,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      signal: request.signal,
      detached: process.platform !== "win32",
    });
    const stdout = captureOutput(child.stdout);
    const stderr = captureOutput(child.stderr);
    childExit = closeEvent(child);
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(
      `${baseUrl}/health`,
      childExit,
      stdout,
      stderr,
      options.fetchImpl ?? fetch,
      request.signal,
      options.startupTimeoutMs ?? 30_000,
    );
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/run`, {
      method: "POST",
      signal: request.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Cloudflare Workers scenario ${request.combo.key} returned HTTP ${response.status}: ${body}`,
      );
    }
  } finally {
    if (child && childExit) {
      await terminate(child, childExit);
    }
    await rm(directory, { recursive: true, force: true });
  }
}

export function createCloudflareWorkersLauncher(
  options: CloudflareWorkersLauncherOptions = {},
): RuntimeLauncher {
  return {
    environment: "cloudflare-workers",
    async launch(request) {
      if (request.combo.environment !== "cloudflare-workers") {
        throw new Error(
          `Launcher cloudflare-workers cannot run ${request.combo.key}; ` +
            `the registry declares ${request.combo.environment}.`,
        );
      }
      await runWorker(request, options);
    },
  };
}

export const cloudflareWorkersLauncher = createCloudflareWorkersLauncher();
