/**
 * Build-independent test-resolution contract (repair round 2026-09-20).
 *
 * The workspace packages' package.json `exports` fields point at `dist/`,
 * which does not exist after a fresh `npm ci` until `npm run build` runs.
 * If vitest resolves `@flowforge/shared` / `@flowforge/engine` through Node's
 * standard resolution, every test file that transitively imports them fails
 * to collect in a fresh clone (the SOD repair evidence: "A test resolving a
 * package via dist/ must build in the test command or resolve to source").
 *
 * Vitest must therefore alias both workspace packages to their TypeScript
 * source, and must keep compiled output (the vitest-config dist glob)
 * excluded from the test glob so stale compiled tests can never run.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(join(root, 'vitest.config.ts'), 'utf-8');

describe('vitest resolves workspace packages from source', () => {
  it('aliases @flowforge/shared to packages/shared/src/index.ts', () => {
    expect(config).toContain("'@flowforge/shared': resolve(root, 'packages/shared/src/index.ts')");
  });

  it('aliases @flowforge/engine to packages/engine/src/index.ts', () => {
    expect(config).toContain("'@flowforge/engine': resolve(root, 'packages/engine/src/index.ts')");
  });

  it('excludes compiled dist output from the test glob', () => {
    expect(config).toContain('**/dist/**');
  });
});

describe('vitest resolves source even when no dist exists', () => {
  it('the packages keep their production exports untouched', () => {
    const shared = readFileSync(join(root, 'packages/shared/package.json'), 'utf-8');
    const engine = readFileSync(join(root, 'packages/engine/package.json'), 'utf-8');
    // Production resolution (the Dockerfile's tsc build) must keep reading
    // dist/ through the exports field — the alias lives only in vitest.
    expect(shared).toContain('"./dist/index.js"');
    expect(engine).toContain('"./dist/index.js"');
  });
});
