import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Layers } from 'lucide-react';
import { dur, ease, enterOffset } from '../lib/motion-tokens';

/** Template preview data — mirrors the five open-source templates the server
 *  serves from /templates (templates.ts). Name + one-line summary only; this
 *  page is anonymous and cannot call the auth-gated listing. */
const TEMPLATE_PREVIEWS = [
  {
    id: 'invoice-chaser',
    name: 'Invoice Chaser',
    summary: 'Weekday mornings, find invoices 14+ days overdue, send a reminder; >30 days asks for approval before escalating.',
  },
  {
    id: 'client-onboarding',
    name: 'Client Onboarding',
    summary: 'A webhook fires when a new client form posts; the welcome sequence replies synchronously and emails the client.',
  },
  {
    id: 'order-follow-up',
    name: 'Order Follow-Up',
    summary: 'On schedule, find stalled orders and nudge the client; orders stalled past your threshold require an approval.',
  },
  {
    id: 'review-request',
    name: 'Review Request',
    summary: 'After a job closes, ask the client for a review and log the request for your own records.',
  },
  {
    id: 'renewal-reminder',
    name: 'Renewal Reminder',
    summary: 'A configurable number of days before contract renewal, email the client and log the entry.',
  },
];

/** Hosted plans per SPEC §3.3 — community self-hosting is free forever. */
const PLANS = [
  {
    id: 'community',
    name: 'Community',
    price: '$0',
    cadence: 'self-hosted',
    runs: 'unlimited',
    seats: '1',
    history: 'local',
    note: 'Apache-2.0. Runs on your own machine.',
  },
  {
    id: 'free',
    name: 'Hosted Free',
    price: '$0',
    cadence: '/month',
    runs: '500 hard cap',
    seats: '1',
    history: '7 days',
    note: 'One workspace to prove the loop works.',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29',
    cadence: '/month',
    runs: '10,000 · $0.03 overage',
    seats: '5',
    history: '90 days + audit',
    note: 'Credential vault, audit log, approvals.',
  },
  {
    id: 'studio',
    name: 'Studio',
    price: '$99',
    cadence: '/month',
    runs: '50,000 · $0.015 overage',
    seats: 'unlimited',
    history: '13 months + audit',
    note: 'OIDC SSO, 24-hour timeouts, 20 concurrent runs.',
  },
];

/**
 * Anonymous entry point — the same precision instrument as the dashboard,
 * not a marketing page. Tight hero, then the §10.2 product surface: the five
 * validated templates and the real plan table, rendered as dense instrument
 * panels, not KPI cards. SOUL.md ¶3 forbids the "modern SaaS template" and
 * "Vercel marketing dashboard" cliches; this screen channels Cron's
 * restrained, confident entry instead.
 */
export default function Landing() {
  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Hero */}
      <div
        className="flex items-center justify-center"
        style={{ minHeight: 'calc(100vh - var(--topbar-height))', padding: 'var(--space-16) var(--space-4)' }}
      >
        <motion.div
          data-testid="landing-hero"
          className="flex flex-col items-center text-center"
          style={{ maxWidth: 'var(--hero-max)', padding: '0 var(--space-6)' }}
          initial={{ opacity: 0, y: enterOffset() }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: dur('base'), ease: ease('emphasized') }}
        >
          {/* Forge mark — same hexagonal identity as Login/Register */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            style={{ width: 'var(--logo-landing)', height: 'var(--logo-landing)', flexShrink: 0 }}
            aria-label="FlowForge logo"
          >
            <path
              d="M12 2L22 7.5V16.5L12 22L2 16.5V7.5L12 2Z"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M12 7L17 9.75V14.25L12 17L7 14.25V9.75L12 7Z"
              fill="var(--accent)"
              fillOpacity="0.2"
              stroke="var(--accent)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
          </svg>

          <h1
            className="page-title auth-logo"
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
              marginTop: 'var(--space-4)',
            }}
          >
            FlowForge Open
          </h1>

          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-secondary)',
              lineHeight: 'var(--line-relaxed)',
              marginTop: 'var(--space-3)',
              maxWidth: 'var(--content-narrow)',
            }}
          >
            Versioned YAML workflows that fire on schedule, webhook, or manual
            trigger — with human approval gates and an audit trail you can trust.
          </p>

          <Link
            to="/register"
            data-testid="landing-register-btn"
            className="btn-primary btn-hero enter-fade-up"
            style={{ marginTop: 'var(--space-8)', textDecoration: 'none' }}
          >
            Get started
            <ArrowRight style={{ width: 'var(--icon-sm)', height: 'var(--icon-sm)' }} />
          </Link>

          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--fg-tertiary)',
              marginTop: 'var(--space-4)',
            }}
          >
            Already have an account?{' '}
            <Link
              to="/login"
              data-testid="landing-login-btn"
              className="link-accent"
            >
              Sign in
            </Link>
          </p>

          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-disabled)',
              marginTop: 'var(--space-12)',
            }}
          >
            Apache-2.0 · open-source core with a hosted cloud
          </p>
        </motion.div>
      </div>

      {/* Validate the product with template previews (§10.2) */}
      <section
        aria-labelledby="landing-templates-heading"
        className="border-t"
        style={{ borderColor: 'var(--border-subtle)', padding: 'var(--space-16) var(--space-6)' }}
      >
        <div className="mx-auto" style={{ maxWidth: 'var(--content-max-wide)' }}>
          <h2
            id="landing-templates-heading"
            className="page-title"
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Five workflows that run themselves
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-8)', maxWidth: 'var(--content-narrow)' }}>
            Every template below is a validated YAML manifest. Pick one, hit Run, watch the steps execute.
          </p>
          <ol
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
            style={{ gap: 'var(--space-4)', listStyle: 'none', padding: 0, margin: 0 }}
          >
            {TEMPLATE_PREVIEWS.map((t) => (
              <li key={t.id} className="surface-card flex flex-col" style={{ padding: 'var(--space-5)' }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                  <Layers style={{ width: 'var(--icon-md)', height: 'var(--icon-md)', color: 'var(--accent)', flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--fg-primary)' }}>
                    {t.name}
                  </span>
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', flex: 1, lineHeight: 'var(--line-normal)' }}>
                  {t.summary}
                </p>
              </li>
            ))}
          </ol>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-6)' }}>
            Create a free workspace to run them against the built-in demo services.{' '}
            <Link to="/register" className="link-accent">
              Set up once, trust that it fires
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Pricing (§10.2) — a spec table, not three KPI cards */}
      <section
        aria-labelledby="landing-pricing-heading"
        className="border-t"
        style={{ borderColor: 'var(--border-subtle)', padding: 'var(--space-16) var(--space-6)' }}
      >
        <div className="mx-auto" style={{ maxWidth: 'var(--content-max-wide)' }}>
          <h2
            id="landing-pricing-heading"
            className="page-title"
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Pricing
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)', marginBottom: 'var(--space-8)', maxWidth: 'var(--content-narrow)' }}>
            One billable unit: a run that reached a terminal state with at least one executed step.
          </p>
          <div className="surface-panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Runs</th>
                  <th>Seats</th>
                  <th>Run history</th>
                  <th style={{ textAlign: 'right' }}>Start</th>
                </tr>
              </thead>
              <tbody>
                {PLANS.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--fg-primary)' }}>
                        {p.name}
                      </span>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', marginTop: 'var(--space-hairline)' }}>
                        {p.note}
                      </div>
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-primary)', fontSize: 'var(--text-sm)' }}>
                      {p.price}
                      {p.id !== 'community' && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)' }}> {p.cadence}</span>
                      )}
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                      {p.runs}
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                      {p.seats}
                    </td>
                    <td style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-sm)' }}>
                      {p.history}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link to="/register" data-testid={`landing-plan-cta-${p.id}`} className="btn-secondary btn-sm" style={{ padding: '0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
                        Get started
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-disabled)', marginTop: 'var(--space-3)' }}>
            Overage is billed per run at the table rate; Pro and Studio activate overage past the included allowance. Free has a hard cap.
          </p>
        </div>
      </section>
    </div>
  );
}
