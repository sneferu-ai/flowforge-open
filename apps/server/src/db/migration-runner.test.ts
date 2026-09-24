/**
 * BUG-017 regression: the migrations dir must resolve next to the runner
 * (src/db/migrations from source; dist/db/migrations compiled — the location
 * scripts/copy-static-assets.js actually copies to).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getMigrationsDir } from './migration-runner.js';

describe('getMigrationsDir', () => {
  it('resolves an existing directory containing the full migration set', () => {
    const dir = getMigrationsDir();
    expect(existsSync(dir)).toBe(true);
    for (const file of [
      '001_init_schema.sql',
      '002_additions.sql',
      '003_system_jobs.sql',
      '004_usage_events_run_event_unique.sql',
      '005_queue_and_webhook_contract.sql',
      '006_repair_schema_alignment.sql',
    ]) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
  });

  it('resolves the runner-sibling directory (never the legacy dist/migrations)', () => {
    const dir = getMigrationsDir().split('\\').join('/');
    expect(dir.endsWith('/db/migrations')).toBe(true);
  });
});

describe('migration files (recorded application, BUG-018)', () => {
  it('every migration records its version in schema_migrations', () => {
    const dir = getMigrationsDir();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const version = file.replace(/\.sql$/, '');
      const sql = readFileSync(join(dir, file), 'utf-8');
      expect(
        sql.includes(`INSERT INTO schema_migrations (version) VALUES ('${version}')`),
        `${file} must record '${version}'`
      ).toBe(true);
    }
  });

  it('run_steps uniqueness is (run_id, step_path, attempt) only (BUG-001)', () => {
    const dir = getMigrationsDir();
    const init = readFileSync(join(dir, '001_init_schema.sql'), 'utf-8');
    expect(init).not.toContain('idx_run_steps_unique');
    expect(init).toContain('uniq_run_steps_path_attempt');
    const repair = readFileSync(join(dir, '006_repair_schema_alignment.sql'), 'utf-8');
    expect(repair).toContain('DROP INDEX IF EXISTS idx_run_steps_unique');
  });
});
