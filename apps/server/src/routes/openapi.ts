/**
 * OpenAPI route — serves the hand-authored OpenAPI 3.1 document at
 * /openapi.json (§9). Same origin, no authentication, outside the
 * { data, error } envelope. The document is a static compiled constant with
 * no DB dependency, so it is served whenever the app is listening — even
 * before migrations complete.
 */

import type { FastifyInstance } from 'fastify';
import { openApiDocument } from '../openapi/document.js';

export async function openApiRoute(app: FastifyInstance): Promise<void> {
  app.get('/openapi.json', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    reply.type('application/json');
    return openApiDocument;
  });
}
