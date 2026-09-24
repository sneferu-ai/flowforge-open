/**
 * Public routes — instance info manifest + static SPA serving.
 * Non-API routes are at root (§4.3); the SPA itself lives in
 * apps/server/web/dist and is served by `staticRoutes`.
 */

import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export function getFrontendDir(): string {
  // §10/§4.3 — the React SPA built to apps/web/dist is THE canonical frontend.
  // The legacy static SPA under apps/server/web/public remains only as a
  // fallback for checkouts where the React build has not been produced.
  const candidates = [
    join(__dirname, '..', '..', '..', 'web', 'dist'), // apps/web/dist (dist execution)
    join(process.cwd(), 'apps', 'web', 'dist'),
    join(process.cwd(), 'web', 'dist'),
    join(__dirname, '..', 'web'), // apps/server/dist/web (copied by build)
    join(__dirname, '..', '..', 'web', 'public'), // legacy static SPA (fallback)
    join(__dirname, '..', '..', 'web', 'dist'),
    join(process.cwd(), 'apps', 'server', 'web', 'public'),
    join(process.cwd(), 'apps', 'server', 'web', 'dist'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]; // Default to first even if not found (will 404 below)
}

export async function publicRoutes(fastify: FastifyInstance): Promise<void> {
  const manifestPayload = {
    data: {
      product: 'FlowForge Open',
      version: '1.0.0',
      api_base: '/api/v1',
      features: {
        oidc: false,
        webhooks: true,
        scheduler: true,
        approvals: true,
        audit: true,
      },
    },
  };

  // Public manifest endpoint (for self-hosted instance info)
  fastify.get('/api/manifest', async () => manifestPayload);
  fastify.get('/api/v1/manifest', async () => manifestPayload);
}

export async function staticRoutes(fastify: FastifyInstance): Promise<void> {
  const frontendDir = getFrontendDir();

  fastify.get('*', async (request, reply) => {
    const requestPath = (request.url || '/').split('?')[0];

    // Never shadow API/hook surfaces.
    if (requestPath.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    if (requestPath === '/hooks' || requestPath.startsWith('/hooks/')) {
      return reply.code(404).send({ error: { code: 'webhook_not_found', message: 'Webhook endpoint not found' } });
    }

    // Try to serve the exact file (path-traversal guarded)
    const filePath = normalize(join(frontendDir, requestPath === '/' ? 'index.html' : requestPath));
    if (!filePath.startsWith(normalize(frontendDir))) {
      return reply.code(403).send('Forbidden');
    }

    let isFile = false;
    try {
      isFile = existsSync(filePath) && statSync(filePath).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) {
      const mime = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
      const content = readFileSync(filePath);
      reply.type(mime).send(content);
      return;
    }

    // Fallback to index.html for SPA routing
    const indexPath = join(frontendDir, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      reply.type('text/html; charset=utf-8').send(content);
      return;
    }

    // No frontend found — say so loudly rather than pretending to be the SPA.
    reply
      .type('text/html; charset=utf-8')
      .code(404)
      .send(
        '<!DOCTYPE html><html><head><title>FlowForge Open</title></head><body>' +
          '<h1>FlowForge Open</h1><p>Frontend not built. Run <code>npm run build</code> to build the SPA in <code>apps/web/dist</code>.</p>' +
          '<p>API is available at <code>/api/*</code> and <code>/api/v1/*</code></p>' +
          '</body></html>'
      );
  });
}
