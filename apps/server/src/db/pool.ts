/**
 * Database pool — single shared pg Pool instance.
 */

import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.FF_DATABASE_URL;
    if (!connectionString) {
      throw new Error('FF_DATABASE_URL is not set');
    }
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await getPool().query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

export interface TxClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

/**
 * Run `fn` inside a single transaction on a dedicated client (BEGIN/COMMIT/
 * ROLLBACK). Used where the spec demands atomicity across multiple writes —
 * e.g. terminal-transition billing (§3.3) and login-attempt bookkeeping (§8.1).
 */
export async function withTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: async <T2 = Record<string, unknown>>(text: string, params?: unknown[]) => {
        const r = await client.query(text, params);
        return { rows: r.rows as T2[], rowCount: r.rowCount ?? 0 };
      },
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
