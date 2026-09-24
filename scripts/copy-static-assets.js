/**
 * Copy non-TS static assets into compiled output so the runtime stage of the
 * image and any dist-only execution can find them:
 *  - SQL migration files → apps/server/dist/db/migrations/
 *  - React SPA build → apps/server/dist/web/ (served by getFrontendDir when
 *    apps/web/dist is absent, e.g. dist-only runtime copies)
 */

import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const copies = [
  {
    from: join(root, 'apps', 'server', 'src', 'db', 'migrations'),
    to: join(root, 'apps', 'server', 'dist', 'db', 'migrations'),
  },
  {
    // The React SPA is the canonical served frontend (§10). Copying it under
    // the server dist keeps dist-only execution self-contained (previously
    // the build never moved apps/web/dist anywhere the server could see).
    from: join(root, 'apps', 'web', 'dist'),
    to: join(root, 'apps', 'server', 'dist', 'web'),
  },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.log(`skip ${from} (not built)`);
    continue;
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
  console.log(`copied ${from} → ${to}`);
}
