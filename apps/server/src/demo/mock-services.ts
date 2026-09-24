/**
 * Demo services — a simple mock HTTP server for testing workflows.
 * Provides endpoints that demo workflows can call:
 *   GET  /status       — returns a JSON status object
 *   POST /echo         — echoes back the request body
 *   GET  /delay/:secs  — delays response by N seconds
 *   GET  /fail         — returns 500
 *   GET  /health       — health check
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = parseInt(process.env.DEMO_PORT || '9999', 10);

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (path === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Status endpoint
  if (path === '/status' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'demo-api',
      status: 'operational',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    }));
    return;
  }

  // Echo endpoint
  if (path === '/echo' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        echoed: true,
        body: body,
        timestamp: new Date().toISOString(),
      }));
    });
    return;
  }

  // Delay endpoint
  const delayMatch = path.match(/^\/delay\/(\d+)$/);
  if (delayMatch && method === 'GET') {
    const seconds = parseInt(delayMatch[1], 10);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        delayed: true,
        seconds,
        timestamp: new Date().toISOString(),
      }));
    }, seconds * 1000);
    return;
  }

  // Fail endpoint
  if (path === '/fail' && method === 'GET') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'intentional_failure',
      message: 'This endpoint always returns 500 for testing error handling',
    }));
    return;
  }

  // JSON placeholder
  if (path === '/json' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      slideshow: {
        author: 'FlowForge Demo',
        date: new Date().toISOString(),
        slides: [
          { title: 'Welcome', content: 'Hello from FlowForge!' },
          { title: 'Status', content: 'All systems operational' },
        ],
      },
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found', path }));
});

server.listen(PORT, () => {
  console.log(`Demo services running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health       — health check');
  console.log('  GET  /status       — JSON status object');
  console.log('  POST /echo         — echo request body');
  console.log('  GET  /delay/:secs  — delayed response');
  console.log('  GET  /fail         — 500 error');
  console.log('  GET  /json         — sample JSON response');
});
