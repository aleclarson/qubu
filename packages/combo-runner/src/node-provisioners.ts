import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import mysql, { type Connection } from "mysql2/promise";
import type { ComboKey } from "./catalog.js";
import { createDisposableProvisioner, type DatabaseProvisioner } from "./provisioners.js";

const DEFAULT_POSTGRES_URL = "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const DEFAULT_MYSQL_URL = "mysql://root:root@127.0.0.1:3306/mysql";

function databaseName(runId: string): string {
  const suffix = runId.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").slice(-36);
  return `qubu_combo_${suffix || Date.now().toString(36)}`;
}

function quotePostgresIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteMysqlIdentifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

async function retry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === 59) {
        throw new Error(`${label} did not become ready after 30 seconds.`, {
          cause: error,
        });
      }
      await delay(500);
    }
  }
  throw new Error(`${label} did not become ready.`, { cause: lastError });
}

async function closeQuietly(connection: { end(): Promise<unknown> }): Promise<void> {
  try {
    await connection.end();
  } catch {
    // The connection may have failed before it finished opening.
  }
}

function postgresqlUrl(): string {
  return process.env.QUBU_POSTGRES_URL ?? process.env.POSTGRES_URL ?? DEFAULT_POSTGRES_URL;
}

function postgresqlAdminUrl(): string {
  if (process.env.QUBU_POSTGRES_ADMIN_URL) {
    return process.env.QUBU_POSTGRES_ADMIN_URL;
  }
  const url = new URL(postgresqlUrl());
  url.pathname = "/postgres";
  return url.toString();
}

function mysqlUrl(): string {
  if (process.env.QUBU_MYSQL_URL ?? process.env.MYSQL_URL) {
    return (process.env.QUBU_MYSQL_URL ?? process.env.MYSQL_URL) as string;
  }
  const user = encodeURIComponent(process.env.MYSQL_USER ?? "root");
  const password = encodeURIComponent(process.env.MYSQL_PASSWORD ?? "root");
  const host = process.env.MYSQL_HOST ?? "127.0.0.1";
  const port = process.env.MYSQL_PORT ?? "3306";
  return `mysql://${user}:${password}@${host}:${port}/mysql`;
}

function mysqlAdminUrl(): string {
  if (process.env.QUBU_MYSQL_ADMIN_URL) {
    return process.env.QUBU_MYSQL_ADMIN_URL;
  }
  const url = new URL(mysqlUrl());
  url.pathname = "/mysql";
  return url.toString();
}

async function dropPostgresDatabase(adminUrl: string, name: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  try {
    await retry("PostgreSQL cleanup connection", () => admin.connect());
    await admin.query(`DROP DATABASE IF EXISTS ${quotePostgresIdentifier(name)}`);
  } finally {
    await closeQuietly(admin);
  }
}

async function createPostgresResource(request: {
  readonly runId: string;
}): Promise<{
  readonly connection: Client;
  readonly connectionString: string;
  readonly metadata: Readonly<Record<string, string>>;
  close(): Promise<void>;
}> {
  const name = databaseName(request.runId);
  const adminUrl = postgresqlAdminUrl();
  const target = new URL(postgresqlUrl());
  target.pathname = `/${name}`;
  const admin = new Client({ connectionString: adminUrl });
  let created = false;
  let client: Client | undefined;

  try {
    await retry("PostgreSQL connection", () => admin.connect());
    await admin.query(`CREATE DATABASE ${quotePostgresIdentifier(name)}`);
    created = true;
    await closeQuietly(admin);

    client = new Client({ connectionString: target.toString() });
    await retry("isolated PostgreSQL connection", () => client!.connect());
    const connectedClient = client;
    return {
      connection: connectedClient,
      connectionString: target.toString(),
      metadata: { database: name },
      async close() {
        await closeQuietly(connectedClient);
        await dropPostgresDatabase(adminUrl, name);
      },
    };
  } catch (error) {
    await closeQuietly(client ?? admin);
    if (created) {
      await dropPostgresDatabase(adminUrl, name).catch(() => undefined);
    }
    throw error;
  }
}

async function dropMysqlDatabase(adminUrl: string, name: string): Promise<void> {
  const admin = await retry("MySQL cleanup connection", () => mysql.createConnection(adminUrl));
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteMysqlIdentifier(name)}`);
  } finally {
    await closeQuietly(admin);
  }
}

async function createMysqlResource(request: {
  readonly runId: string;
}): Promise<{
  readonly connection: Connection;
  readonly connectionString: string;
  readonly metadata: Readonly<Record<string, string>>;
  close(): Promise<void>;
}> {
  const name = databaseName(request.runId);
  const targetUrl = mysqlUrl();
  const adminUrl = mysqlAdminUrl();
  const target = new URL(targetUrl);
  target.pathname = `/${name}`;
  const admin = await retry("MySQL connection", () => mysql.createConnection(adminUrl));
  let created = false;
  let connection: Connection | undefined;

  try {
    await admin.query(`CREATE DATABASE ${quoteMysqlIdentifier(name)}`);
    created = true;
    await closeQuietly(admin);
    connection = await retry("isolated MySQL connection", () => mysql.createConnection(target.toString()));
    const connected = connection;
    return {
      connection: connected,
      connectionString: target.toString(),
      metadata: { database: name },
      async close() {
        await closeQuietly(connected);
        await dropMysqlDatabase(adminUrl, name);
      },
    };
  } catch (error) {
    await closeQuietly(connection ?? admin);
    if (created) {
      await dropMysqlDatabase(adminUrl, name).catch(() => undefined);
    }
    throw error;
  }
}

export const nodeSqliteProvisioner = createDisposableProvisioner(
  "sqlite",
  async () => {
    const connection = new DatabaseSync(":memory:");
    return {
      connection,
      metadata: { database: ":memory:" },
      async close() {
        connection.close();
      },
    };
  },
);

export const nodePostgresProvisioner = createDisposableProvisioner(
  "postgresql",
  createPostgresResource,
);

export const nodeMysqlProvisioner = createDisposableProvisioner("mysql", createMysqlResource);

/** The Node scenarios have independent provisioners even when engines match. */
export const nodeProvisioners: Readonly<Partial<Record<ComboKey, DatabaseProvisioner>>> = {
  "node-sqlite/sqlite/node": nodeSqliteProvisioner,
  "pg/postgresql/node": nodePostgresProvisioner,
  "mysql2-promise/mysql/node": nodeMysqlProvisioner,
};
