/**
 * @flowforge/engine — manifest schema, expression evaluator, validation, and storage interface.
 */

export {
  // Schema
  ManifestSchema,
  StepSchema,
  TriggerSchema,
  TriggerTypeSchema,
  AuthModeSchema,
  InputDefSchema,
  InputTypeSchema,
  InputValidationSchema,
  InputMappingSchema,
  RetrySchema,
  StepTypeSchema,
  HttpStepConfigSchema,
  NotifyStepConfigSchema,
  ConditionStepConfigSchema,
  DelayStepConfigSchema,
  TransformStepConfigSchema,
  ForEachStepConfigSchema,
  LogStepConfigSchema,
  ReplyStepConfigSchema,
  ManualApprovalStepConfigSchema,
  createStepSchema,
} from './manifest-schema.js';

export type {
  Manifest,
  Step,
  Trigger,
  TriggerType,
  InputDef,
  InputType,
  RetryConfig,
  ValidationWarning,
  ValidationError,
  ValidationResult,
} from './manifest-schema.js';

export { validateManifest, parseManifest, isValidCronExpression } from './manifest-validator.js';

export {
  ExpressionError,
  evaluateExpression,
  resolveInterpolation,
  resolvePureInterpolation,
  stringifyValue,
  isTruthy,
  isEqual,
  parseExpression,
} from './expression-evaluator.js';

export type { EvalContext } from './expression-evaluator.js';

export type {
  StorageAdapter,
  Run,
  RunStep,
  Trigger as TriggerRecord,
  CreateRunParams,
  InsertRunStepParams,
} from './storage-adapter.js';

export type {
  StepExecutor,
  StepExecutionContext,
  StepResult,
  SecretResolver,
  LoopContext,
} from './step-executor.js';

export { InMemoryStorageAdapter } from './in-memory-storage-adapter.js';

