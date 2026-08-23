import type { ComboCell, DatabaseEngine } from "./catalog.js";

/** A database connection owned by one isolated verification run. */
export interface ProvisionedDatabase<Connection = unknown> {
  readonly engine: DatabaseEngine;
  readonly connection: Connection;
  readonly connectionString?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /** Close the connection and remove any run-owned resources. */
  dispose(): Promise<void>;
}

export interface VerificationContext<Connection = unknown> {
  readonly combo: ComboCell;
  readonly database: ProvisionedDatabase<Connection>;
  readonly signal?: AbortSignal;
}

/**
 * Scenario modules keep their own example and assertions. The shared runner
 * only requires one async function that throws when the database round trip
 * fails.
 */
export type VerifyFunction<Connection = unknown> = (
  context: VerificationContext<Connection>,
) => Promise<void>;

export interface VerificationModule<Connection = unknown> {
  readonly verify: VerifyFunction<Connection>;
}

export function isVerificationModule(value: unknown): value is VerificationModule {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "verify" in value && typeof value.verify === "function";
}
