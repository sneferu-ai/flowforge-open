/**
 * Plan definitions for FlowForge Open.
 * Seeded by `seed.js plans` — 5 rows.
 */

export const PLAN_IDS = {
  COMMUNITY: 'community',
  FREE: 'free',
  PRO: 'pro',
  STUDIO: 'studio',
  DEMO: 'demo',
} as const;

export type PlanId = (typeof PLAN_IDS)[keyof typeof PLAN_IDS];

export interface PlanDefinition {
  id: string;
  name: string;
  price_cents: number;
  run_limit: number | null;
  seat_limit: number | null;
  overage_rate_cents: number | null;
  run_history_days: number | null;
  audit_retention_days: number | null;
  workflow_timeout_hours: number | null;
  rate_limit_per_min: number | null;
  concurrency_limit: number | null;
  feature_flags: {
    credential_vault: boolean;
    audit_log: boolean;
    manual_approval: boolean;
    webhook_triggers: boolean;
    schedule_triggers: boolean;
    api_tokens: boolean;
  };
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    id: PLAN_IDS.COMMUNITY,
    name: 'Community',
    price_cents: 0,
    run_limit: null,
    seat_limit: 1,
    overage_rate_cents: null,
    run_history_days: null,
    audit_retention_days: null,
    workflow_timeout_hours: null,
    rate_limit_per_min: null,
    concurrency_limit: null,
    feature_flags: {
      credential_vault: true,
      audit_log: false,
      manual_approval: true,
      webhook_triggers: true,
      schedule_triggers: true,
      api_tokens: true,
    },
  },
  {
    id: PLAN_IDS.FREE,
    name: 'Hosted Free',
    price_cents: 0,
    run_limit: 500,
    seat_limit: 1,
    overage_rate_cents: null,
    run_history_days: 7,
    audit_retention_days: null,
    workflow_timeout_hours: 1,
    rate_limit_per_min: 120,
    concurrency_limit: 1,
    feature_flags: {
      credential_vault: false,
      audit_log: false,
      manual_approval: false,
      webhook_triggers: true,
      schedule_triggers: true,
      api_tokens: true,
    },
  },
  {
    id: PLAN_IDS.PRO,
    name: 'Pro',
    price_cents: 2900,
    run_limit: 10000,
    seat_limit: 5,
    overage_rate_cents: 3,
    run_history_days: 90,
    audit_retention_days: 90,
    workflow_timeout_hours: 6,
    rate_limit_per_min: 600,
    concurrency_limit: 5,
    feature_flags: {
      credential_vault: true,
      audit_log: true,
      manual_approval: true,
      webhook_triggers: true,
      schedule_triggers: true,
      api_tokens: true,
    },
  },
  {
    id: PLAN_IDS.STUDIO,
    name: 'Studio',
    price_cents: 9900,
    run_limit: 50000,
    seat_limit: null,
    overage_rate_cents: 15,
    run_history_days: 396,
    audit_retention_days: 365,
    workflow_timeout_hours: 24,
    rate_limit_per_min: 2000,
    concurrency_limit: 20,
    feature_flags: {
      credential_vault: true,
      audit_log: true,
      manual_approval: true,
      webhook_triggers: true,
      schedule_triggers: true,
      api_tokens: true,
    },
  },
  {
    id: PLAN_IDS.DEMO,
    name: 'Demo',
    price_cents: 0,
    run_limit: null,
    seat_limit: 1,
    overage_rate_cents: null,
    run_history_days: null,
    audit_retention_days: null,
    workflow_timeout_hours: 24,
    rate_limit_per_min: 2000,
    concurrency_limit: 5,
    feature_flags: {
      credential_vault: true,
      audit_log: true,
      manual_approval: true,
      webhook_triggers: true,
      schedule_triggers: true,
      api_tokens: true,
    },
  },
];

export function getPlanDefinition(id: string): PlanDefinition | undefined {
  return PLAN_DEFINITIONS.find((p) => p.id === id);
}
