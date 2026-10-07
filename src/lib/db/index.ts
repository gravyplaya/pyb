import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import pg from "pg";

/**
 * Database access for PYB. Single pool per process. DATABASE_URL must
 * include sslmode=require for remote Postgres (Dokploy); local dev is TCP.
 */

const globalForPg = globalThis as unknown as { __pybPool?: Pool };

export const pool: Pool =
  globalForPg.__pybPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForPg.__pybPool = pool;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
