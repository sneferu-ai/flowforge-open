/**
 * Migration entry point (§14.3): `node apps/server/dist/migrate.js up`.
 * Thin CLI over the migration runner so standalone deploy scripts (and the
 * operator's init checklist) can migrate without starting the API server.
 */

import { getPool, closePool } from './pool.js';
import { runMigrations } from './migration-runner.js';

async function main() {
  const action = process.argv[2] ?? 'up';
  if (action !== 'up') {
    console.error(`Usage: node apps/server/dist/migrate.js up`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await runMigrations(getPool());
    console.log(`Migrated: ${result.applied.length} applied, ${result.skipped.length} skipped`);
    for (const version of result.applied) console.log(`  applied ${version}`);
  } catch (err) {
    console.error('Migration failed:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
