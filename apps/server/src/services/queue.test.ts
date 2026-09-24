/**
 * Queue-plane isolation: the BullMQ key prefix derives from the database
 * identity, so two installations sharing one Redis can never consume each
 * other's jobs (§4.2 topology safety).
 */

import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('queue key prefix', () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>).FF_DATABASE_URL;
  });

  it('derives deterministically from FF_DATABASE_URL ("ff" + 8 hex chars)', async () => {
    process.env.FF_DATABASE_URL = 'postgres://user:pass@db-1:5432/flowforge';
    const mod = await import('./queue.js');
    const a = mod.queueKeyPrefix();
    expect(a).toMatch(/^ff[0-9a-f]{8}$/);
    expect(a).toBe(mod.queueKeyPrefix());
  });

  it('differs across databases; stable fallback without the env var', async () => {
    process.env.FF_DATABASE_URL = 'postgres://user:pass@db-1:5432/one';
    const mod = await import('./queue.js');
    const one = mod.queueKeyPrefix();
    process.env.FF_DATABASE_URL = 'postgres://user:pass@db-1:5432/two';
    const two = mod.queueKeyPrefix();
    expect(one).not.toBe(two);
    delete (process.env as Record<string, string | undefined>).FF_DATABASE_URL;
    const fallback = mod.queueKeyPrefix();
    expect(fallback).toMatch(/^ff[0-9a-f]{8}$/);
    expect(fallback).not.toBe(one);
  });
});

describe('run_events lifecycle inserts (live-PG 42P08 regression)', () => {
  // Live PostgreSQL rejects INSERTs where one parameter feeds both a typed
  // column ($1 → run_id uuid) and a jsonb_build_object payload ("could not
  // determine data type of parameter $1" / "inconsistent types deduced").
  // The params in the payload position must be separate numbered params.
  // These source pins keep the pattern from regressing; the e2e suite is the
  // runtime net (it failed on exactly this bug).
  const srcDir = dirname(fileURLToPath(import.meta.url));

  const cases: Array<{ file: string; sql: string; params: string[] }> = [
    {
      file: 'queue.ts',
      sql: "VALUES ($1, 'run.queued', jsonb_build_object('run_id', $2::text))",
      params: ['[runId, runId]'],
    },
    {
      file: 'run-executor.ts',
      sql: "VALUES ($1, 'run.started', jsonb_build_object('run_id', $2::text, 'started_at', now()))",
      params: ['[runId, runId]'],
    },
    {
      file: 'run-executor.ts',
      sql: "VALUES ($1, 'run.waiting', jsonb_build_object('run_id', $3::text, 'resume_at', $2::text))",
      params: ['[runId, resumeAt, runId]'],
    },
    {
      file: 'run-executor.ts',
      sql: "jsonb_build_object('run_id', $3::text, 'finished_at', now(), 'total_running_seconds', $2::int))",
      params: ['[runId, totalRunningSeconds, runId]'],
    },
  ];

  for (const { file, sql, params } of cases) {
    it(`${file} emits the event payload with separate parameters`, () => {
      const source = readFileSync(join(srcDir, file), 'utf-8');
      expect(source).toContain(sql);
      expect(source).toContain(params[0]);
    });
  }
});
