/**
 * FlowForge Open — Manifest Schema (zod)
 * api_version: flowforge/v1
 *
 * This single zod schema is shipped to CLI, API, and editor.
 */

import { z } from 'zod';

// --- Input definition ---
export const InputTypeSchema = z.enum(['string', 'integer', 'boolean']);
export type InputType = z.infer<typeof InputTypeSchema>;

export const InputValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
});

export const InputDefSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'input name must match ^[a-z][a-z0-9_]{0,63}$'),
  type: InputTypeSchema,
  required: z.boolean().default(false),
  default: z.any().optional(),
  validation: InputValidationSchema.optional(),
});

// --- Trigger ---
export const TriggerTypeSchema = z.enum(['schedule', 'webhook', 'event']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const AuthModeSchema = z.enum(['hmac', 'header', 'none']);

export const InputMappingSchema = z.record(z.string(), z.string());

export const TriggerSchema = z.object({
  type: TriggerTypeSchema,
  // schedule
  cron: z.string().optional(),
  timezone: z.string().optional(),
  // webhook
  path: z.string().optional(),
  require_signature: z.boolean().default(true),
  auth_mode: AuthModeSchema.default('hmac'),
  secret: z.string().optional(),
  auth_header: z.string().optional(),
  auth_secret: z.string().optional(),
  sync: z.boolean().default(false),
  input_mapping: InputMappingSchema.optional(),
});

// --- Retry config ---
export const RetrySchema = z.object({
  attempts: z.number().int().min(1).max(10).default(3),
  backoff: z.enum(['fixed', 'exponential']).default('exponential'),
  base_ms: z.number().int().min(0).default(500),
  max_ms: z.number().int().min(0).default(30000),
  jitter: z.boolean().default(true),
});

// --- Step types ---
export const StepTypeSchema = z.enum([
  'http',
  'notify',
  'condition',
  'delay',
  'transform',
  'for_each',
  'log',
  'reply',
  'manual_approval',
  'parallel',
]);
export type StepType = z.infer<typeof StepTypeSchema>;

// Recursive step schema — defined with z.lazy
export type Step = {
  id: string;
  type: StepType;
  with?: Record<string, unknown>;
  if?: string;
  retry?: z.infer<typeof RetrySchema>;
  timeout_seconds?: number;
  on_error?: 'abort' | 'continue';
  steps?: Step[];
};

// HTTP step config
export const HttpStepConfigSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  idempotency_key: z.string().optional(),
});

// Notify step config
export const NotifyStepConfigSchema = z.object({
  channel: z.enum(['email', 'inbox']),
  to: z.string(),
  subject: z.string().optional(),
  body: z.string(),
});

// Condition step config
export const ConditionStepConfigSchema = z.object({
  when: z.string(),
  then: z.array(z.any()).default([]),
  else: z.array(z.any()).optional(),
});

// Delay step config
export const DelayStepConfigSchema = z.object({
  duration: z.string(),
});

// Transform step config
export const TransformStepConfigSchema = z.object({
  set: z.record(z.string(), z.string()),
});

// ForEach step config. NOTE (§5.2 canonical example): the iteration body lives
// in the step-level `steps:` field, not inside `with` — `with.steps` is an
// accepted alias, so the config schema keeps it optional.
export const ForEachStepConfigSchema = z.object({
  over: z.string(),
  limit: z.number().int().min(1).max(1000).default(100),
  steps: z.array(z.any()).optional(),
  allow_concurrent: z.boolean().optional(), // reserved for future use
});

// Log step config
export const LogStepConfigSchema = z.object({
  level: z.enum(['info', 'warn', 'error']).default('info'),
  message: z.string(),
});

// Reply step config
export const ReplyStepConfigSchema = z.object({
  status: z.number().int().min(200).max(599),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string(),
});

// Manual approval step config
export const ManualApprovalStepConfigSchema = z.object({
  prompt: z.string(),
  timeout_seconds: z.number().int().positive().default(86400),
  on_timeout: z.enum(['skip', 'abort']).default('skip'),
});

/**
 * Per-type `with` contract (§5.3) — every step type validates its own config
 * object, so a missing `url` or `duration` fails at validation time with a
 * precise path instead of surfacing as a runtime error mid-run.
 * `parallel` has no config schema: the type itself is rejected by the validator
 * (parallel_not_supported_in_v1).
 */
export const STEP_WITH_CONFIG_SCHEMAS: Partial<Record<StepType, z.ZodTypeAny>> = {
  http: HttpStepConfigSchema,
  notify: NotifyStepConfigSchema,
  condition: ConditionStepConfigSchema,
  delay: DelayStepConfigSchema,
  transform: TransformStepConfigSchema,
  for_each: ForEachStepConfigSchema,
  log: LogStepConfigSchema,
  reply: ReplyStepConfigSchema,
  manual_approval: ManualApprovalStepConfigSchema,
};

function withStepConfigValidation<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const step = value as { type?: string; with?: unknown };
    const configSchema = STEP_WITH_CONFIG_SCHEMAS[step.type as StepType];
    if (!configSchema) return;
    const result = configSchema.safeParse(step.with ?? {});
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['with', ...issue.path],
        message: `${step.type} step config: ${issue.message}`,
      });
    }
  });
}

// Step schema factory (recursive)
export function createStepSchema(maxDepth: number = 4): z.ZodType<Step> {
  const baseFields = z.object({
    // §5.2's canonical example (and the template gallery) use underscore step ids
    // like `fetch_overdue`; the schema therefore accepts [a-z0-9_-].
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'step id must match ^[a-z][a-z0-9_-]{0,63}$'),
    if: z.string().optional(),
    retry: RetrySchema.optional(),
    timeout_seconds: z.number().int().positive().optional(),
    on_error: z.enum(['abort', 'continue']).default('abort'),
  });

  if (maxDepth <= 0) {
    // At max depth, don't allow nesting
    return withStepConfigValidation(
      z.object({
        ...baseFields.shape,
        type: z.enum(['http', 'notify', 'condition', 'delay', 'transform', 'log', 'reply', 'manual_approval']),
        with: z.record(z.string(), z.any()).optional(),
      })
    ) as z.ZodType<Step>;
  }

  const childStepSchema = z.lazy(() => createStepSchema(maxDepth - 1));

  return withStepConfigValidation(
    z.object({
      ...baseFields.shape,
      type: StepTypeSchema,
      with: z.record(z.string(), z.any()).optional(),
      steps: z.array(childStepSchema).optional(),
    })
  ) as z.ZodType<Step>;
}

export const StepSchema = createStepSchema(4);

// --- Top-level manifest ---
export const ManifestSchema = z.object({
  api_version: z.literal('flowforge/v1'),
  name: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/, 'name must match ^[a-z][a-z0-9-]{2,63}$'),
  summary: z.string().max(200).optional(),
  allow_concurrent: z.boolean().default(false),
  inputs: z.array(InputDefSchema).optional(),
  triggers: z.array(TriggerSchema).min(1).max(3),
  defaults: z.object({
    retry: RetrySchema.optional(),
    timeout_seconds: z.number().int().positive().default(60),
  }).optional(),
  steps: z.array(StepSchema).min(1).max(50),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type InputDef = z.infer<typeof InputDefSchema>;
export type RetryConfig = z.infer<typeof RetrySchema>;

// --- Validation result ---
export interface ValidationError {
  code: string;
  message: string;
  path: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
