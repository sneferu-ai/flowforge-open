/**
 * Source-pin tests for the demo seed contract (§10.4) and the seed CLI entry.
 *
 * These are structural source pins — the same pattern as
 * migration-runner.test.ts — because seeding requires a live Postgres (and
 * Redis for the plan-cache invalidation). The pins keep the spec-required
 * demo identity ("Acme Creative" / acme-creative / demo@acme.test), the
 * legacy-database self-heal paths, and the CLI-entry guard from regressing
 * between e2e runs. Live behavior is additionally covered by the packaging
 * contract test and the browser smoke suite.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../routes/workflows.js';
import { TEMPLATES } from '../routes/templates.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(srcDir, 'seed.ts'), 'utf-8');

describe('§10.4 demo workspace identity (seed.ts)', () => {
  it("INSERTs the workspace named 'Acme Creative'", () => {
    expect(source).toContain(`VALUES ('Acme Creative', $1, 'demo', $2)`);
  });

  it("seeds the canonical slug 'acme-creative'", () => {
    expect(source).toContain(`const DEMO_SLUG = 'acme-creative'`);
  });

  it('looks up the canonical slug before falling back to the legacy slug', () => {
    expect(source).toContain(`const DEMO_SLUG = 'acme-creative'`);
    expect(source).toContain(`const LEGACY_SLUG = 'demo-workspace'`);
    // The canonical lookup happens first; the legacy lookup is the
    // empty-result fallback of that same query.
    const canonicalLookup = source.indexOf(
      `let wsExisting = await pool.query`,
      source.indexOf(`const DEMO_SLUG`)
    );
    const legacyIndex = source.indexOf(`[LEGACY_SLUG]`);
    expect(canonicalLookup).toBeGreaterThan(-1);
    expect(source).toContain('[DEMO_SLUG]');
    expect(legacyIndex).toBeGreaterThan(canonicalLookup);
    expect(source).toContain('if (wsExisting.rows.length === 0)');
  });

  it('reconciles legacy rows: name renaming, slug renaming, and NULL-slug backfill in one UPDATE', () => {
    expect(source).toContain(`SET name = 'Acme Creative', slug = $1`);
    expect(source).toContain(
      `(name <> 'Acme Creative' OR slug IS NULL OR slug <> $1)`
    );
  });

  it('resolves the demo identity through getDemoSettings() (import pinned)', () => {
    expect(source).toContain(`import { getDemoSettings, isDemoSeedEnabled } from '../env-bootstrap.js'`);
  });
});

describe('demo identity value-flow source pins (§3.3)', () => {
  it('calls getDemoSettings() and binds the result inside seedDemo', () => {
    expect(source).toContain('const settings = getDemoSettings()');
  });

  it('uses settings.email in the user lookup, insert, and reconcile paths', () => {
    const matches = source.match(/settings\.email/g) ?? [];
    // lookup SELECT + INSERT params + login-lock DELETE + raced SELECT + log line
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("'SELECT id, password_hash FROM users WHERE email = $1',\n    [settings.email]");
  });

  it('uses settings.password as the argon2.verify candidate in the reconciliation path', () => {
    expect(source).toContain('argon2.verify(existing.rows[0].password_hash, settings.password)');
    expect(source).toContain('argon2.hash(settings.password,');
  });

  it('never reads process.env.FF_DEMO_EMAIL / FF_DEMO_PASSWORD directly', () => {
    expect(source).not.toMatch(/process\.env\.FF_DEMO_EMAIL/);
    expect(source).not.toMatch(/process\.env\.FF_DEMO_PASSWORD/);
  });

  it('contains no hardcoded demo email or password literals', () => {
    expect(source).not.toContain("'demo@acme.test'");
    expect(source).not.toContain('"demo@acme.test"');
    expect(source).not.toContain('demo-pass-2026');
    expect(source).not.toContain('changeme1');
  });

  it('rewrites ONLY password_hash (+updated_at) on drift — the UPDATE never touches name', () => {
    const update = source.match(/UPDATE users SET[^`]*WHERE id = \$2'/);
    expect(update).not.toBeNull();
    expect(update![0]).toContain('password_hash = $1');
    expect(update![0]).not.toContain('name =');
  });

  it('wraps the user insert in try/catch handling the 23505 unique_violation', () => {
    expect(source).toContain(`code === '23505'`);
    expect(source).toContain('Demo user already exists, skipping insert');
    const insertIdx = source.indexOf(`INSERT INTO users (email, password_hash, name)`);
    const tryIdx = source.lastIndexOf('try {', insertIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeLessThan(insertIdx);
  });

  it('restores membership role to owner via ON CONFLICT DO UPDATE (never DO NOTHING)', () => {
    expect(source).toContain('ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = \'owner\'');
    expect(source).not.toContain('ON CONFLICT (workspace_id, user_id) DO NOTHING');
  });

  it('gates the CLI demo target through isDemoSeedEnabled', () => {
    expect(source).toContain('isDemoSeedEnabled(process.env.FF_SEED_DEMO)');
  });
});

describe('§10.4 five seeded demo workflows (human-readable names)', () => {
  const expected: Array<{ templateId: string; name: string }> = [
    { templateId: 'invoice-chaser', name: 'Invoice Chaser' },
    { templateId: 'client-onboarding', name: 'Client Onboarding' },
    { templateId: 'order-follow-up', name: 'Order Follow-Up' },
    { templateId: 'review-request', name: 'Review Request' },
    { templateId: 'renewal-reminder', name: 'Renewal Reminder' },
  ];

  it('seeds exactly the five template-gallery workflows with display names', () => {
    for (const { templateId, name } of expected) {
      expect(source, templateId).toContain(`{ templateId: '${templateId}', name: '${name}' }`);
    }
  });

  it('display-name slugs are identical to the legacy slug-style names (dedup backward compatibility)', () => {
    for (const { templateId, name } of expected) {
      expect(slugify(name), name).toBe(templateId);
    }
  });

  it('every referenced template exists in TEMPLATES', () => {
    const ids = new Set(TEMPLATES.map((t) => t.id));
    for (const { templateId } of expected) {
      expect(ids.has(templateId), templateId).toBe(true);
    }
  });

  it('dedup check hashes the display name through slugify()', () => {
    expect(source).toContain('const slug = slugify(example.name)');
  });

  it('renames only rows still carrying the exact legacy seed name (user renames preserved)', () => {
    expect(source).toContain(
      `UPDATE workflows SET name = $1 WHERE workspace_id = $2 AND slug = $3 AND name = $4`
    );
    expect(source).toContain('[example.name, workspaceId, slug, example.templateId]');
  });
});

describe('seed CLI entry (node dist/db/seed.js <target>)', () => {
  it('runs main() when invoked directly (module import must run nothing)', () => {
    expect(source).toContain(
      `if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)`
    );
  });

  it('never uses the bare string-concat guard (as-typed relative argv paths never match import.meta.url)', () => {
    expect(source).not.toContain('`file://${process.argv[1]}`');
  });

  it('supports the documented targets: all, migrate, plans, jobs, demo', () => {
    for (const target of ['all', 'migrate', 'plans', 'jobs', 'demo']) {
      expect(source, target).toContain(`target === '${target}'`);
    }
  });
});
