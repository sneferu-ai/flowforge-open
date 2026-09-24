/**
 * FlowForge Open — Manifest Validator
 *
 * Parses YAML and applies all validation rules from the spec.
 */

import { load as parseYaml } from 'js-yaml';
import { IANAZone } from 'luxon';
import { ManifestSchema, STEP_WITH_CONFIG_SCHEMAS, type Manifest, type Step, type Trigger, type ValidationResult, type ValidationError, type ValidationWarning } from './manifest-schema.js';
import { parseExpression, ExpressionError } from './expression-evaluator.js';
import { ERROR_CODES } from '@flowforge/shared';

const MAX_NESTING_DEPTH = 4;
const FORBIDDEN_HTTP_HEADERS = new Set(['host', 'cookie', 'x-forwarded-for']);
const ALLOWED_REPLY_HEADERS = new Set(['content-type', 'location', 'retry-after']);

/**
 * Schedule-trigger cron grammar (§5.1: "cron: string — required for schedule;
 * 5-field"). This mirrors the executor's grammar exactly
 * (apps/server/src/lib/cron.ts — star, star-slash step, ranges, comma lists,
 * plain values) so a manifest the validator accepts is always schedulable.
 * Keep the two in sync.
 */
const CRON_FIELD_LIMITS: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7],  // day of week (0/7 = Sunday)
];

export function isValidCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((field, idx) => isValidCronField(field, CRON_FIELD_LIMITS[idx][0], CRON_FIELD_LIMITS[idx][1]));
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field.length === 0) return false;
  for (const piece of field.split(',')) {
    if (piece === '*') continue;
    const stepMatch = /^\*\/(\d+)$/.exec(piece);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      if (step < 1 || step > max) return false;
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(piece);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (lo < min || hi > max || lo > hi) return false;
      continue;
    }
    if (/^\d+$/.test(piece)) {
      const v = parseInt(piece, 10);
      if (v < min || v > max) return false;
      continue;
    }
    return false;
  }
  return true;
}

// Parallel step types are reserved
const PARALLEL_TYPE = 'parallel';
const EVENT_TRIGGER_TYPE = 'event';

interface StepNode {
  step: Step;
  path: string;
  depth: number;
}

function flattenSteps(steps: Step[], prefix: string, depth: number): StepNode[] {
  const nodes: StepNode[] = [];
  for (const step of steps) {
    const path = prefix ? `${prefix}.${step.id}` : step.id;
    nodes.push({ step, path, depth });
    if (step.steps) {
      nodes.push(...flattenSteps(step.steps, path, depth + 1));
    }
    // Condition branches
    if (step.with?.then && Array.isArray(step.with.then)) {
      const thenSteps = step.with.then as Step[];
      nodes.push(...flattenSteps(thenSteps, `${path}.then`, depth + 1));
    }
    if (step.with?.else && Array.isArray(step.with.else)) {
      const elseSteps = step.with.else as Step[];
      nodes.push(...flattenSteps(elseSteps, `${path}.else`, depth + 1));
    }
  }
  return nodes;
}

function countReplySteps(steps: Step[]): number {
  let count = 0;
  for (const step of steps) {
    if (step.type === 'reply') count++;
    if (step.steps) count += countReplySteps(step.steps);
    if (step.with?.then && Array.isArray(step.with.then)) {
      count += countReplySteps(step.with.then as Step[]);
    }
    if (step.with?.else && Array.isArray(step.with.else)) {
      count += countReplySteps(step.with.else as Step[]);
    }
  }
  return count;
}

function getMaxNestingDepth(steps: Step[], currentDepth: number = 1): number {
  let maxDepth = currentDepth;
  for (const step of steps) {
    if (step.steps) {
      maxDepth = Math.max(maxDepth, getMaxNestingDepth(step.steps, currentDepth + 1));
    }
    if (step.with?.then && Array.isArray(step.with.then)) {
      maxDepth = Math.max(maxDepth, getMaxNestingDepth(step.with.then as Step[], currentDepth + 1));
    }
    if (step.with?.else && Array.isArray(step.with.else)) {
      maxDepth = Math.max(maxDepth, getMaxNestingDepth(step.with.else as Step[], currentDepth + 1));
    }
  }
  return maxDepth;
}

function hasWebhookTrigger(triggers: Trigger[]): boolean {
  return triggers.some((t) => t.type === 'webhook');
}

function checkDuplicateIds(steps: Step[], seen: Set<string>, errors: ValidationError[]): void {
  for (const step of steps) {
    if (seen.has(step.id)) {
      errors.push({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Duplicate step id: ${step.id}`,
        path: `steps.${step.id}`,
      });
    }
    seen.add(step.id);
    if (step.steps) checkDuplicateIds(step.steps, seen, errors);
    if (step.with?.then && Array.isArray(step.with.then)) {
      checkDuplicateIds(step.with.then as Step[], seen, errors);
    }
    if (step.with?.else && Array.isArray(step.with.else)) {
      checkDuplicateIds(step.with.else as Step[], seen, errors);
    }
  }
}

function validateHttpStep(step: Step, errors: ValidationError[]): void {
  const config = step.with ?? {};
  const method = config.method as string;
  const body = config.body as string | undefined;

  // GET/HEAD with body → body_on_get_head
  if ((method === 'GET' || method === 'HEAD') && body !== undefined && body !== null && body !== '') {
    errors.push({
      code: ERROR_CODES.BODY_ON_GET_HEAD,
      message: `HTTP ${method} cannot have a body`,
      path: `steps.${step.id}.with.body`,
    });
  }

  // Forbidden headers
  const headers = config.headers as Record<string, string> | undefined;
  if (headers) {
    for (const name of Object.keys(headers)) {
      if (FORBIDDEN_HTTP_HEADERS.has(name.toLowerCase())) {
        errors.push({
          code: ERROR_CODES.FORBIDDEN_HEADER,
          message: `Forbidden header: ${name}`,
          path: `steps.${step.id}.with.headers.${name}`,
        });
      }
    }
  }
}

function validateReplyStep(step: Step, hasWebhook: boolean, errors: ValidationError[]): void {
  if (!hasWebhook) {
    errors.push({
      code: ERROR_CODES.REPLY_IN_NON_WEBHOOK,
      message: 'reply step is only allowed in webhook-triggered workflows',
      path: `steps.${step.id}`,
    });
  }

  // Reply headers
  const headers = step.with?.headers as Record<string, string> | undefined;
  if (headers) {
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (!ALLOWED_REPLY_HEADERS.has(lower) && !lower.startsWith('x-flowforge-')) {
        errors.push({
          code: ERROR_CODES.FORBIDDEN_REPLY_HEADER,
          message: `Forbidden reply header: ${name}`,
          path: `steps.${step.id}.with.headers.${name}`,
        });
      }
    }
  }
}

function validateTriggers(triggers: Trigger[], errors: ValidationError[], warnings: ValidationWarning[]): void {
  for (let i = 0; i < triggers.length; i++) {
    const trigger = triggers[i];
    const path = `triggers[${i}]`;

    // Event trigger
    if (trigger.type === EVENT_TRIGGER_TYPE) {
      errors.push({
        code: ERROR_CODES.EVENT_TRIGGER_NOT_SUPPORTED,
        message: 'event trigger type is not supported in v1',
        path: `${path}.type`,
      });
    }

    // Schedule trigger
    if (trigger.type === 'schedule') {
      if (!trigger.cron) {
        errors.push({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'cron is required for schedule trigger',
          path: `${path}.cron`,
        });
      } else if (!isValidCronExpression(trigger.cron)) {
        errors.push({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `invalid cron expression: ${JSON.stringify(trigger.cron)} (expected 5 fields: minute hour day-of-month month day-of-week)`,
          path: `${path}.cron`,
        });
      }
      if (!trigger.timezone) {
        errors.push({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'timezone is required for schedule trigger',
          path: `${path}.timezone`,
        });
      } else if (!IANAZone.isValidZone(trigger.timezone)) {
        errors.push({
          code: ERROR_CODES.INVALID_TIMEZONE,
          message: `invalid IANA timezone: ${JSON.stringify(trigger.timezone)}`,
          path: `${path}.timezone`,
        });
      }
    }

    // Webhook trigger auth validation
    if (trigger.type === 'webhook') {
      if (trigger.auth_mode === 'hmac') {
        if (trigger.require_signature === false) {
          errors.push({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'require_signature must be true when auth_mode is hmac',
            path: `${path}.require_signature`,
          });
        }
        if (!trigger.secret || trigger.secret.trim() === '') {
          errors.push({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'webhook secret name cannot be empty',
            path: `${path}.secret`,
          });
        }
      }
      if (trigger.auth_mode === 'header') {
        if (!trigger.auth_header || trigger.auth_header.trim() === '') {
          errors.push({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'auth_header is required when auth_mode is header',
            path: `${path}.auth_header`,
          });
        }
        if (!trigger.auth_secret || trigger.auth_secret.trim() === '') {
          errors.push({
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'webhook secret name cannot be empty',
            path: `${path}.auth_secret`,
          });
        }
      }
    }
  }
}

function validateRequiredInputsForSchedule(manifest: Manifest, errors: ValidationError[]): void {
  if (!manifest.inputs) return;
  const hasSchedule = manifest.triggers.some((t) => t.type === 'schedule');
  if (!hasSchedule) return;

  for (const input of manifest.inputs) {
    if (input.required && input.default === undefined) {
      // Check if any webhook trigger has input_mapping for this input
      const hasWebhookMapping = manifest.triggers.some(
        (t) => t.type === 'webhook' && t.input_mapping && input.name in t.input_mapping
      );
      if (!hasWebhookMapping) {
        errors.push({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `required_input_unmapped_for_schedule: input '${input.name}' is required but has no default and no webhook mapping`,
          path: `inputs.${input.name}`,
        });
      }
    }
  }
}

function validateFilterMapExpressions(step: Step, warnings: ValidationWarning[]): void {
  // Check filter/map inner expressions in 'if' fields and expression fields
  const checkExpr = (expr: string | undefined, path: string) => {
    if (!expr) return;
    // Look for filter( or map( calls with a string-literal second arg. The
    // literal may contain escaped quotes (\"), so match escape-aware:
    // (?:\\.|[^"\\])* consumes escaped chars without terminating the literal.
    const filterMapRegex = /(?:filter|map)\s*\([^,]+,\s*"((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = filterMapRegex.exec(expr)) !== null) {
      // Unescape expression-level escapes (\" → ", \\ → \) before parsing.
      const innerExpr = match[1].replace(/\\(.)/g, '$1');
      try {
        parseExpression(innerExpr);
      } catch (e) {
        if (e instanceof ExpressionError) {
          warnings.push({
            code: 'unparseable_expression',
            message: `Unparseable inner expression in filter/map: ${e.message}`,
            path,
          });
        }
      }
    }
  };

  checkExpr(step.if, `steps.${step.id}.if`);
  if (step.with?.when) checkExpr(step.with.when as string, `steps.${step.id}.with.when`);
  if (step.with?.over) checkExpr(step.with.over as string, `steps.${step.id}.with.over`);

  if (step.steps) {
    for (const child of step.steps) {
      validateFilterMapExpressions(child, warnings);
    }
  }
  if (step.with?.then && Array.isArray(step.with.then)) {
    for (const child of step.with.then as Step[]) {
      validateFilterMapExpressions(child, warnings);
    }
  }
  if (step.with?.else && Array.isArray(step.with.else)) {
    for (const child of step.with.else as Step[]) {
      validateFilterMapExpressions(child, warnings);
    }
  }
}

/**
 * Parse and validate a manifest YAML string.
 */
export function validateManifest(yamlString: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Size check — 256KB in UTF-8 BYTES (§5.1). JavaScript string length counts
  // UTF-16 code units, which undercounts multi-byte characters.
  if (new TextEncoder().encode(yamlString).length > 256 * 1024) {
    return {
      valid: false,
      errors: [{ code: ERROR_CODES.MANIFEST_TOO_LARGE, message: 'Manifest exceeds 256KB', path: '' }],
      warnings: [],
    };
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlString);
  } catch (e) {
    return {
      valid: false,
      errors: [{
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `YAML parse error: ${(e as Error).message}`,
        path: '',
      }],
      warnings: [],
    };
  }

  if (parsed === null || typeof parsed !== 'object') {
    return {
      valid: false,
      errors: [{
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Manifest must be a YAML object',
        path: '',
      }],
      warnings: [],
    };
  }

  // Zod schema validation
  const zodResult = ManifestSchema.safeParse(parsed);
  if (!zodResult.success) {
    for (const issue of zodResult.error.issues) {
      errors.push({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: issue.message,
        path: issue.path.join('.'),
      });
    }
    // If zod validation failed, we may not have a valid manifest to do further checks
    return { valid: false, errors, warnings };
  }

  const manifest = zodResult.data as Manifest;

  // Custom validation rules

  // 1. Event trigger
  validateTriggers(manifest.triggers, errors, warnings);

  // 2. Parallel step type
  const allNodes = flattenSteps(manifest.steps, '', 1);
  for (const node of allNodes) {
    if (node.step.type === PARALLEL_TYPE) {
      errors.push({
        code: ERROR_CODES.PARALLEL_NOT_SUPPORTED,
        message: 'parallel step type is not supported in v1',
        path: `steps.${node.path}`,
      });
    }
  }

  // 3. Reply in non-webhook
  const webhookPresent = hasWebhookTrigger(manifest.triggers);

  // 4. Multiple reply steps
  const replyCount = countReplySteps(manifest.steps);
  if (replyCount > 1) {
    errors.push({
      code: ERROR_CODES.MULTIPLE_REPLY_STEPS,
      message: 'Only one reply step is allowed per manifest',
      path: 'steps',
    });
  }

  // 5. Nesting depth
  const maxDepth = getMaxNestingDepth(manifest.steps, 1);
  if (maxDepth > MAX_NESTING_DEPTH) {
    errors.push({
      code: ERROR_CODES.NESTING_TOO_DEEP,
      message: `Nesting depth ${maxDepth} exceeds maximum of ${MAX_NESTING_DEPTH}`,
      path: 'steps',
    });
  }

  // 6. Duplicate step ids
  checkDuplicateIds(manifest.steps, new Set(), errors);

  // 7. Step-type-specific validation
  for (const node of allNodes) {
    if (node.step.type === 'http') {
      validateHttpStep(node.step, errors);
    }
    if (node.step.type === 'reply') {
      validateReplyStep(node.step, webhookPresent, errors);
    }
    // Per-type `with` contract for steps nested inside condition branches
    // (with.then/with.else are z.any() arrays that bypass the zod step schema;
    // top-level and step-level `steps:` arrays are already checked there, and
    // zod-stage failures return before this point — so no duplicate errors).
    if (node.path.includes('.then') || node.path.includes('.else')) {
      const configSchema = STEP_WITH_CONFIG_SCHEMAS[node.step.type];
      if (configSchema) {
        const result = configSchema.safeParse(node.step.with ?? {});
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `${node.step.type} step config: ${issue.message}`,
              path: `steps.${node.path}.with${issue.path.length ? '.' + issue.path.join('.') : ''}`,
            });
          }
        }
      }
    }
  }

  // 8. Required inputs for schedule
  validateRequiredInputsForSchedule(manifest, errors);

  // 9. filter/map inner expression parse check
  for (const step of manifest.steps) {
    validateFilterMapExpressions(step, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Parse manifest YAML and return the typed manifest (throws on invalid).
 */
export function parseManifest(yamlString: string): Manifest {
  const result = validateManifest(yamlString);
  if (!result.valid) {
    throw new Error(`Invalid manifest: ${result.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`);
  }
  // Re-parse since validateManifest already validated
  const parsed = parseYaml(yamlString) as unknown;
  return ManifestSchema.parse(parsed) as Manifest;
}
