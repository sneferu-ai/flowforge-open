/**
 * Demo data routes — deterministic synthetic data for the five template
 * workflows (§12 Unit 12). Escalation invoice is always 45 days overdue.
 * These endpoints are part of the deliverable: templates exercise them via
 * `{{ env.FF_APP_URL }}/api/v1/demo/...`, so they are also mounted under
 * /api/v1 alongside the root mount.
 */

import type { FastifyInstance } from 'fastify';
import { getDemoSettings } from '../env-bootstrap.js';

export interface DemoInvoice {
  number: string;
  client_name: string;
  client_email: string;
  amount: number;
  currency: string;
  issued_at: string;
  due_at: string;
  days_overdue: number;
  status: 'open' | 'overdue' | 'paid';
}

export interface DemoOrder {
  number: string;
  client_name: string;
  client_email: string;
  placed_at: string;
  status: 'new' | 'in_progress' | 'stalled' | 'delivered';
  stalled_hours: number;
}

export interface DemoClient {
  id: string;
  name: string;
  email: string;
  since: string;
  last_project: string;
  last_project_closed_at: string;
}

const INVOICES: DemoInvoice[] = [
  {
    number: 'INV-1042', client_name: 'Acme Studio', client_email: 'billing@acme.test',
    amount: 1240, currency: 'USD', issued_at: '2026-08-01', due_at: '2026-08-15',
    days_overdue: 17, status: 'overdue',
  },
  {
    number: 'INV-1027', client_name: 'Northwind Ltd', client_email: 'ap@northwind.test',
    amount: 3200, currency: 'USD', issued_at: '2026-07-22', due_at: '2026-08-05',
    days_overdue: 27, status: 'overdue',
  },
  {
    number: 'INV-0990', client_name: 'Bloom Creative', client_email: 'finance@bloom.test',
    amount: 5600, currency: 'USD', issued_at: '2026-06-30', due_at: '2026-07-14',
    days_overdue: 45, status: 'open',
  },
  {
    number: 'INV-1080', client_name: 'Halcyon Books', client_email: 'accounts@halcyon.test',
    amount: 890, currency: 'USD', issued_at: '2026-08-20', due_at: '2026-09-03',
    days_overdue: 0, status: 'open',
  },
];

const ORDERS: DemoOrder[] = [
  {
    number: 'ORD-5511', client_name: 'Acme Studio', client_email: 'ops@acme.test',
    placed_at: '2026-09-10', status: 'stalled', stalled_hours: 60,
  },
  {
    number: 'ORD-5518', client_name: 'Northwind Ltd', client_email: 'ops@northwind.test',
    placed_at: '2026-09-14', status: 'stalled', stalled_hours: 30,
  },
  {
    number: 'ORD-5520', client_name: 'Bloom Creative', client_email: 'ops@bloom.test',
    placed_at: '2026-09-18', status: 'new', stalled_hours: 0,
  },
  {
    number: 'ORD-5499', client_name: 'Halcyon Books', client_email: 'ops@halcyon.test',
    placed_at: '2026-09-01', status: 'delivered', stalled_hours: 0,
  },
];

const CLIENTS: DemoClient[] = [
  {
    id: 'c-001', name: 'Acme Studio', email: 'hello@acme.test', since: '2025-03-11',
    last_project: 'Brand refresh', last_project_closed_at: '2026-09-12',
  },
  {
    id: 'c-002', name: 'Northwind Ltd', email: 'hello@northwind.test', since: '2025-07-02',
    last_project: 'Storefront build', last_project_closed_at: '2026-08-28',
  },
  {
    id: 'c-003', name: 'Bloom Creative', email: 'hello@bloom.test', since: '2026-01-15',
    last_project: 'Product shoot', last_project_closed_at: '2026-09-04',
  },
  {
    id: 'c-004', name: 'Halcyon Books', email: 'hello@halcyon.test', since: '2024-11-20',
    last_project: 'Catalogue layout', last_project_closed_at: '2026-07-30',
  },
];

export async function demoRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/demo/invoices', async (request) => {
    const { status, include_escalations } = request.query as {
      status?: string;
      include_escalations?: string;
    };
    const withEscalation = include_escalations === '1' || include_escalations === 'true';
    let invoices = INVOICES;
    if (status) {
      if (status === 'overdue') {
        invoices = invoices.filter((i) => i.days_overdue > 0);
      } else {
        invoices = invoices.filter((i) => i.status === status);
      }
    }
    if (!withEscalation) {
      // The 45-day escalation fixture is opt-in (§12): without
      // include_escalations the overdue sweep maxes out at 27 days (< 30),
      // so the default Invoice Chaser run needs no approval.
      invoices = invoices.filter((i) => i.days_overdue < 45);
    }
    return { invoices };
  });

  fastify.get('/demo/orders', async (request) => {
    const { status } = request.query as { status?: string };
    // 'stuck' is the product-language alias for 'stalled' (§12 verification
    // probes ?status=stuck; templates use the row value 'stalled').
    const normalized = status === 'stuck' ? 'stalled' : status;
    const orders = normalized ? ORDERS.filter((o) => o.status === normalized) : ORDERS;
    return { orders };
  });

  fastify.get('/demo/clients', async () => {
    return { clients: CLIENTS };
  });

  // §9/§10.4 — the configured demo credentials, so the login page can show
  // them verbatim and a human can sign in immediately. ALWAYS registered:
  // with the SPA catch-all, a conditionally absent route would answer
  // 200 HTML, not the required JSON 404. The enabled check flows through
  // getDemoSettings() (which calls isDemoSeedEnabled internally); the values
  // are returned exactly as configured, and the password is never logged.
  fastify.get('/demo/credentials', async (_request, reply) => {
    const settings = getDemoSettings();
    if (!settings.enabled) {
      reply.code(404);
      reply.type('application/json');
      return { error: 'not_found' };
    }
    reply.header('Cache-Control', 'no-store');
    reply.type('application/json');
    return { email: settings.email, password: settings.password };
  });
}
