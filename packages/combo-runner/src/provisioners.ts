import type { ComboCell, DatabaseEngine } from "./catalog.js";
import type { ProvisionedDatabase } from "./contract.js";

export interface ProvisionRequest {
  readonly combo: ComboCell;
  readonly runId: string;
  readonly signal?: AbortSignal;
}

/** The resource returned by a provisioner factory before the runner wraps it. */
export interface ProvisionedResource<Connection = unknown> {
  readonly connection: Connection;
  readonly connectionString?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  close(): Promise<void>;
}

export type ProvisionerFactory<Connection = unknown> = (
  request: ProvisionRequest,
) => Promise<ProvisionedResource<Connection>>;

export interface DatabaseProvisioner<Connection = unknown> {
  readonly engine: DatabaseEngine;
  provision(request: ProvisionRequest): Promise<ProvisionedDatabase<Connection>>;
}

/**
 * Adapt a database-specific factory to the runner's idempotent dispose
 * contract. The factory owns the actual SQLite, PostgreSQL, MySQL, D1, or
 * PGlite setup. The wrapper owns exactly-once cleanup.
 */
export function createDisposableProvisioner<Connection>(
  engine: DatabaseEngine,
  factory: ProvisionerFactory<Connection>,
): DatabaseProvisioner<Connection> {
  return {
    engine,
    async provision(request) {
      const resource = await factory(request);
      let disposed = false;
      return {
        engine,
        connection: resource.connection,
        connectionString: resource.connectionString,
        metadata: resource.metadata,
        async dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          await resource.close();
        },
      };
    },
  };
}

/**
 * Useful while a runtime is listed in the catalog but its local database
 * setup has not landed yet. It fails with an actionable message if selected.
 */
export function createUnavailableProvisioner(
  engine: DatabaseEngine,
  reason: string,
): DatabaseProvisioner<never> {
  return {
    engine,
    async provision(request) {
      throw new Error(
        `No ${engine} provisioner is configured for ${request.combo.key}: ${reason}`,
      );
    },
  };
}
