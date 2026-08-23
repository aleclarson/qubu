import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { createServer as createPortServer } from "node:net";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import type { LaunchRequest, RuntimeLauncher } from "./runtime.js";
import { resolveNodeScenario } from "./node.js";
import { bundleRuntimeEntry, copyPgliteBrowserAssets } from "./bundler.js";

interface BrowserPage {
  goto(url: string): Promise<unknown>;
  evaluate<T>(pageFunction: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

interface BrowserSession {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface BrowserLauncherOptions {
  /** Injectable browser factory for launcher boundary tests. */
  readonly launchBrowser?: () => Promise<BrowserSession>;
  /** Injectable temporary-directory factory for launcher boundary tests. */
  readonly createTempDirectory?: () => Promise<string>;
  /** Injectable free-port allocator for launcher boundary tests. */
  readonly allocatePort?: () => Promise<number>;
  /** Injectable browser bundler for launcher boundary tests. */
  readonly buildBrowser?: (request: LaunchRequest, directory: string) => Promise<string>;
}

const BROWSER_ASSETS = new Set(["bundle.js", "pglite.wasm", "initdb.wasm", "pglite.data"]);

async function allocatePort(): Promise<number> {
  const server = createPortServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!port) {
    throw new Error("Could not allocate a local browser server port.");
  }
  return port;
}

function browserSource(request: LaunchRequest): string {
  const scenario = resolveNodeScenario(request.scenario);
  if (!(scenario instanceof URL) || scenario.protocol !== "file:") {
    throw new Error(`Browser scenarios must resolve to a local file: ${String(request.scenario)}`);
  }
  const scenarioPath = fileURLToPath(scenario);
  return `
import { PGlite } from "@electric-sql/pglite";
import { verify } from ${JSON.stringify(scenarioPath)};

const combo = ${JSON.stringify(request.combo)};

globalThis.__qubuComboRun = async () => {
  const database = await PGlite.create("memory://");
  try {
    await verify({
      combo,
      database: {
        engine: "postgresql",
        connection: database,
        metadata: { dataDir: "memory://" },
        async dispose() {},
      },
    });
  } finally {
    await database.close();
  }
};
`;
}

async function buildBrowser(request: LaunchRequest, directory: string): Promise<string> {
  const bundlePath = await bundleRuntimeEntry(browserSource(request), {
    entryPoint: join(directory, "browser-entry.mjs"),
    outfile: join(directory, "bundle.js"),
    platform: "browser",
    format: "esm",
  });
  await copyPgliteBrowserAssets(directory);
  return bundlePath;
}

function respond(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, { "content-type": contentType, "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function createStaticServer(directory: string, port: number) {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
    if (pathname === "/") {
      respond(
        response,
        200,
        "<!doctype html><meta charset=\"utf-8\"><script type=\"module\" src=\"/bundle.js\"></script>",
        "text/html; charset=utf-8",
      );
      return;
    }
    const asset = basename(pathname);
    if (pathname !== `/${asset}` || !BROWSER_ASSETS.has(asset)) {
      respond(response, 404, "not found", "text/plain; charset=utf-8");
      return;
    }
    try {
      const content = await readFile(join(directory, asset));
      const contentType = asset.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : asset.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream";
      response.writeHead(200, { "content-type": contentType, "content-length": content.byteLength });
      response.end(content);
    } catch {
      respond(response, 404, "not found", "text/plain; charset=utf-8");
    }
  });
  return {
    server,
    async listen(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
    },
    async close(): Promise<void> {
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function closeQuietly(close: (() => Promise<void>) | undefined): Promise<void> {
  try {
    await close?.();
  } catch {
    // Preserve the scenario error while still attempting every cleanup step.
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Browser scenario launch was aborted."));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Browser scenario launch was aborted."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function runBrowser(request: LaunchRequest, options: BrowserLauncherOptions): Promise<void> {
  if (request.signal?.aborted) {
    throw request.signal.reason ?? new Error("Browser scenario launch was aborted.");
  }
  const createTempDirectory =
    options.createTempDirectory ?? (() => mkdtemp(join(tmpdir(), "qubu-combo-browser-")));
  const directory = await createTempDirectory();
  let browser: BrowserSession | undefined;
  let page: BrowserPage | undefined;
  let port = 0;
  let server: ReturnType<typeof createStaticServer> | undefined;
  try {
    port = await (options.allocatePort ?? allocatePort)();
    server = createStaticServer(directory, port);
    await (options.buildBrowser ?? buildBrowser)(request, directory);
    await server.listen();
    browser = await (options.launchBrowser ?? (() => chromium.launch({ headless: true })))(
    );
    page = await browser.newPage();
    await withAbort(page.goto(`http://127.0.0.1:${port}/`), request.signal);
    await withAbort(
      page.evaluate(async () => {
        const run = (globalThis as typeof globalThis & { __qubuComboRun?: () => Promise<void> }).__qubuComboRun;
        if (!run) {
          throw new Error("Browser bundle did not expose the verification entrypoint.");
        }
        await run();
      }),
      request.signal,
    );
  } finally {
    await closeQuietly(page ? () => page!.close() : undefined);
    await closeQuietly(browser ? () => browser!.close() : undefined);
    await closeQuietly(server ? () => server!.close() : undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

export function createBrowserLauncher(options: BrowserLauncherOptions = {}): RuntimeLauncher {
  return {
    environment: "browser",
    async launch(request) {
      if (request.combo.environment !== "browser") {
        throw new Error(
          `Launcher browser cannot run ${request.combo.key}; ` +
            `the registry declares ${request.combo.environment}.`,
        );
      }
      await runBrowser(request, options);
    },
  };
}

export const browserLauncher = createBrowserLauncher();
