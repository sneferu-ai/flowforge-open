/**
 * §10/§4.3 — the canonical served frontend is the React build at apps/web/dist.
 * The legacy static SPA at apps/server/web/public is only a fallback, so this
 * suite stays green in build-independent checkouts: the canonical dir is
 * asserted only when the React build exists, and either state must resolve to
 * a servable index.html.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { getFrontendDir } from './public.js';

const canonicalBuild = join(process.cwd(), 'apps', 'web', 'dist');

describe('getFrontendDir', () => {
  it('prefers the React build in apps/web/dist when it exists', () => {
    const dir = getFrontendDir();
    const normalized = dir.split(sep).join('/');
    if (existsSync(canonicalBuild)) {
      expect(normalized.endsWith(join('apps', 'web', 'dist').split(sep).join('/'))).toBe(true);
    }
    // Either state must resolve to a servable frontend directory.
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('serves an index.html for SPA routing fallback', () => {
    const dir = getFrontendDir();
    const index = join(dir, 'index.html');
    expect(existsSync(index)).toBe(true);
  });
});
