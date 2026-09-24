/**
 * runtime-services.json contract regression pins (repair round 2026-09-20,
 * pair-coder pass).
 *
 * runtime-services.json is the product's declaration of the SOD prepared
 * environment graph. The static contract gate refuses three regressions this
 * tree has lived through, and these tests pin the file so no cooperative
 * seat can drift it back:
 *
 *  1. Removing the `worker` service — the prepared graph requires it
 *     (image `application`, kind `worker`, depends on postgres+redis). Round
 *     2 removed the service and the gate refused "delivered service graph
 *     differs from the prepared specification".
 *  2. Re-adding the worker with `command: []` — the gate's final check
 *     (`workers_without_command`) refuses a worker service that declares no
 *     command: "worker startup is missing … fill its real command argv".
 *     The prepared record's `command: []` is the placeholder the product
 *     MUST fill, not the value to copy.
 *  3. Inventing a no-op command — the command must be the product's real
 *     worker entry point (spec "Entry points": `node apps/worker/dist/index.js`).
 *
 * Coexistence truth (why the standalone worker alongside the embedded-mode
 * server is the correct, safe graph): BullMQ delivers each queued job to
 * exactly one consumer; the scheduler tick is Redis-lock serialized
 * (docs/ARCHITECTURE.md §scheduler); the notification outbox dispatcher
 * claims rows with FOR UPDATE SKIP LOCKED; the system-jobs consumer is
 * jobId-deduped. No consumer pair can double-execute a run or double-fire
 * an interval job.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface GraphService {
  name: string;
  kind: string;
  image: string;
  connection_env: string;
  command: string[];
  depends_on: string[];
}

interface RuntimeGraph {
  schema: string;
  plan_sha256: string;
  services: GraphService[];
  storage: Array<{ name: string; path: string; persistent: boolean }>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
// The gate's own image regex: infrastructure images are sha256-prefixed,
// the worker's is the literal "application".
const PINNED_IMAGE = /^sha256:[0-9a-f]{64}$/;
const SERVICE_KEYS = ['name', 'kind', 'image', 'connection_env', 'command', 'depends_on'];

function graph(): RuntimeGraph {
  return JSON.parse(readFileSync(join(root, 'runtime-services.json'), 'utf-8')) as RuntimeGraph;
}

describe('runtime-services.json SOD graph contract', () => {
  const g = graph();

  it('declares the runtime graph schema with a plan identity', () => {
    expect(g.schema).toBe('sneferu.sod.runtime-graph/v1');
    expect(g.plan_sha256).toMatch(SHA256_HEX);
  });

  it('declares exactly the prepared graph keys at the top level', () => {
    expect(Object.keys(g).sort()).toEqual(['plan_sha256', 'schema', 'services', 'storage']);
  });

  it('declares the three prepared services, no more, no less', () => {
    expect(g.services.map((s) => s.name)).toEqual(['postgres', 'redis', 'worker']);
  });

  it('declares every service with exactly the six gate-recognized fields', () => {
    for (const service of g.services) {
      expect(Object.keys(service).sort()).toEqual([...SERVICE_KEYS].sort());
    }
  });

  it('keeps the prepared postgres image and connection variable', () => {
    const postgres = g.services.find((s) => s.kind === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres!.image).toMatch(PINNED_IMAGE);
    expect(postgres!.connection_env).toBe('FF_DATABASE_URL');
    expect(postgres!.command).toEqual([]);
    expect(postgres!.depends_on).toEqual([]);
  });

  it('keeps the prepared redis image and connection variable', () => {
    const redis = g.services.find((s) => s.kind === 'redis');
    expect(redis).toBeDefined();
    expect(redis!.image).toMatch(PINNED_IMAGE);
    expect(redis!.connection_env).toBe('FF_REDIS_URL');
    expect(redis!.command).toEqual([]);
    expect(redis!.depends_on).toEqual([]);
  });

  it('keeps the prepared worker service: application image, worker kind, DB/queue dependencies', () => {
    const worker = g.services.find((s) => s.kind === 'worker');
    expect(worker).toBeDefined();
    expect(worker!.image).toBe('application');
    expect(worker!.connection_env).toBe('');
    expect(worker!.depends_on).toEqual(['postgres', 'redis']);
  });

  it('fills the worker command with REAL argv — the gate refuses a commandless worker', () => {
    const worker = g.services.find((s) => s.kind === 'worker')!;
    expect(Array.isArray(worker.command)).toBe(true);
    expect(worker.command.length).toBeGreaterThan(0);
    for (const arg of worker.command) {
      expect(typeof arg).toBe('string');
      expect(arg.length).toBeGreaterThan(0);
      expect(arg).not.toContain('\0');
    }
  });

  it('pins the worker command to the spec worker entry point, not an inert placeholder', () => {
    const worker = g.services.find((s) => s.kind === 'worker')!;
    const entrypoint = worker.command.join(' ');
    // Spec "Entry points": Worker: `node apps/worker/dist/index.js`.
    expect(worker.command).toEqual(['node', 'apps/worker/dist/index.js']);
    // A no-op command (sleep, tail, echo) would satisfy the mechanical
    // non-empty check while shipping a do-nothing worker container.
    expect(entrypoint).not.toMatch(/^(sleep|tail|echo|true|sh\s)/);
  });

  it('declares no application storage volumes beyond the prepared graph', () => {
    expect(g.storage).toEqual([]);
  });

  it('has no unknown registerable fields anywhere in the graph', () => {
    for (const service of g.services) {
      for (const key of Object.keys(service)) {
        expect(SERVICE_KEYS).toContain(key);
      }
    }
    for (const entry of g.storage) {
      expect(Object.keys(entry).sort()).toEqual(['name', 'path', 'persistent']);
    }
  });

  it('contains no shell chaining or env injection in any command arg', () => {
    for (const service of g.services) {
      for (const arg of service.command) {
        expect(arg).not.toMatch(/[;&|`$()]/);
      }
    }
  });
});
