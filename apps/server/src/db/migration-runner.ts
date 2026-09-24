/**
 * Migration runner — applies SQL files in order, tracks in schema_migrations table.
 */

import { Pool } from 'pg';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the migrations directory. The build (scripts/copy-static-assets.js)
 * copies the .sql files next to the compiled runner — apps/server/dist/db/
 * migrations — so the primary candidate is the sibling `migrations/` dir,
 * which resolves correctly from BOTH the source tree (apps/server/src/db) and
 * compiled output (apps/server/dist/db). The cwd candidates cover checkouts
 * where only the source tree is present.
 */
export function getMigrationsDir(): string {
  const siblingDir = join(__dirname, 'migrations');
  if (existsSync(siblingDir)) return siblingDir;
  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'apps', 'server', 'src', 'db', 'migrations'),
    join(cwd, 'apps', 'server', 'dist', 'db', 'migrations'),
    join(cwd, 'src', 'db', 'migrations'),
    join(cwd, 'migrations'),
    // Legacy pre-repair layout (apps/server/dist/migrations) — last resort.
    join(__dirname, '..', 'migrations'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return siblingDir; // let the caller fail loudly
}

export async function runMigrations(pool: Pool): Promise<{ applied: string[]; skipped: string[] }> {
  const migrationsDir = getMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  // §14.3 — advisory lock serializes concurrent migrations across processes
  // (standalone server + worker booting against the same database). The lock
  // is session-scoped, so it runs on one dedicated client held for the whole
  // migration, not the pooled connections.
  const client = await pool.connect();
  await client.query(`SELECT pg_advisory_lock(hashtext('flowforge_migrations'))`);
  try {
    // Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Get already-applied migrations
    const result = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(result.rows.map((r) => r.version));

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');

      if (appliedSet.has(version)) {
        skipped.push(version);
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');

      // Run in a transaction
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        applied.push(version);
        appliedSet.add(version);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${version} failed: ${(err as Error).message}`);
      }
    }

    return { applied, skipped };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('flowforge_migrations'))`).catch(() => {});
    client.release();
  }
}

/**
 * True when at least one migration has been applied (§4.3 readiness).
 * Never throws — readiness treats a broken migrations table as not-ready.
 */
export async function checkMigrationsApplied(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    return (result.rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
