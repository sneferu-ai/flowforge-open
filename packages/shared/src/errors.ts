/**
 * Error codes used across API and step execution.
 */

export const ERROR_CODES = {
  // API HTTP errors
  INVALID_CREDENTIALS: 'invalid_credentials',
  ACCOUNT_LOCKED: 'account_locked',
  CSRF_TOKEN_MISSING: 'csrf_token_missing',
  CSRF_TOKEN_INVALID: 'csrf_token_invalid',
  FORBIDDEN: 'forbidden',
  WORKSPACE_NOT_FOUND: 'workspace_not_found',
  WORKFLOW_NOT_FOUND: 'workflow_not_found',
  RUN_NOT_FOUND: 'run_not_found',
  VALIDATION_ERROR: 'validation_error',
  MANIFEST_TOO_LARGE: 'manifest_too_large',
  RUN_LIMIT_EXCEEDED: 'run_limit_exceeded',
  CONCURRENCY_LIMIT_EXCEEDED: 'concurrency_limit_exceeded',
  WEBHOOK_RATE_LIMITED: 'webhook_rate_limited',
  REQUEST_TOO_LARGE: 'request_too_large',
  INVALID_SIGNATURE: 'invalid_signature',
  TIMESTAMP_MISSING: 'timestamp_missing',
  TIMESTAMP_OUT_OF_TOLERANCE: 'timestamp_out_of_tolerance',
  DUPLICATE_WEBHOOK: 'duplicate_webhook',
  WORKFLOW_DISABLED: 'workflow_disabled',
  WEBHOOK_NOT_FOUND: 'webhook_not_found',
  WEBHOOK_PATH_CONFLICT: 'webhook_path_conflict',
  INPUT_MAPPING_FAILED: 'input_mapping_failed',
  INVALID_PAYLOAD_FORMAT: 'invalid_payload_format',
  INVITATION_EXPIRED: 'invitation_expired',
  CANNOT_REMOVE_LAST_OWNER: 'cannot_remove_last_owner',
  PLAN_FEATURE_REQUIRED: 'plan_feature_required',
  PASSWORD_TOO_COMMON: 'password_too_common',
  UNKNOWN_ENV_VARIABLE: 'unknown_env_variable',
  BODY_ON_GET_HEAD: 'body_on_get_head',
  FORBIDDEN_REPLY_HEADER: 'forbidden_reply_header',
  HOST_NOT_ALLOWED: 'host_not_allowed',
  REPLY_IN_NON_WEBHOOK: 'reply_in_non_webhook',
  MULTIPLE_REPLY_STEPS: 'multiple_reply_steps',
  EVENT_TRIGGER_NOT_SUPPORTED: 'event_trigger_not_supported_in_v1',
  PARALLEL_NOT_SUPPORTED: 'parallel_not_supported_in_v1',
  NESTING_TOO_DEEP: 'nesting_too_deep',
  APPROVAL_ALREADY_DECIDED: 'approval_already_decided',
  CREDENTIAL_IN_USE: 'credential_in_use',
  INVALID_STATE: 'invalid_state',
  INVALID_NONCE: 'invalid_nonce',
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  INTERNAL_ERROR: 'internal_error',

  // Step error codes
  PRIVATE_IP_BLOCKED: 'private_ip_blocked',
  TIMEOUT_EXCEEDED: 'timeout_exceeded',
  OPERATION_LIMIT_EXCEEDED: 'operation_limit_exceeded',
  EXPRESSION_TOO_LONG: 'expression_too_long',
  UNPARSEABLE_EXPRESSION: 'unparseable_expression',
  TYPE_MISMATCH: 'type_mismatch',
  UNKNOWN_RECIPIENT: 'unknown_recipient',
  INVALID_DATE_FORMAT: 'invalid_date_format',
  INVALID_TIMEZONE: 'invalid_timezone',
  FORBIDDEN_PROPERTY_ACCESS: 'forbidden_property_access',
  FORBIDDEN_HEADER: 'forbidden_header',
  REPLY_BODY_TOO_LARGE: 'reply_body_too_large',
  SECRET_NOT_FOUND: 'secret_not_found',
  RUN_STATE_TOO_LARGE: 'run_state_too_large',
  NON_INTERACTIVE_APPROVAL: 'non_interactive_approval_unsupported',
  UNKNOWN_VARIABLE: 'unknown_variable',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** HTTP status code mapping for API error codes */
export function httpStatusFor(code: string): number {
  const map: Record<string, number> = {
    [ERROR_CODES.INVALID_CREDENTIALS]: 401,
    [ERROR_CODES.ACCOUNT_LOCKED]: 423,
    [ERROR_CODES.CSRF_TOKEN_MISSING]: 403,
    [ERROR_CODES.CSRF_TOKEN_INVALID]: 403,
    [ERROR_CODES.FORBIDDEN]: 403,
    [ERROR_CODES.UNAUTHORIZED]: 401,
    [ERROR_CODES.WORKSPACE_NOT_FOUND]: 404,
    [ERROR_CODES.WORKFLOW_NOT_FOUND]: 404,
    [ERROR_CODES.RUN_NOT_FOUND]: 404,
    [ERROR_CODES.NOT_FOUND]: 404,
    [ERROR_CODES.VALIDATION_ERROR]: 400,
    [ERROR_CODES.MANIFEST_TOO_LARGE]: 400,
    [ERROR_CODES.BAD_REQUEST]: 400,
    [ERROR_CODES.RUN_LIMIT_EXCEEDED]: 429,
    [ERROR_CODES.CONCURRENCY_LIMIT_EXCEEDED]: 429,
    [ERROR_CODES.WEBHOOK_RATE_LIMITED]: 429,
    [ERROR_CODES.REQUEST_TOO_LARGE]: 413,
    [ERROR_CODES.INVALID_SIGNATURE]: 401,
    [ERROR_CODES.TIMESTAMP_MISSING]: 401,
    [ERROR_CODES.TIMESTAMP_OUT_OF_TOLERANCE]: 401,
    [ERROR_CODES.DUPLICATE_WEBHOOK]: 409,
    [ERROR_CODES.WORKFLOW_DISABLED]: 410,
    [ERROR_CODES.WEBHOOK_NOT_FOUND]: 404,
    [ERROR_CODES.WEBHOOK_PATH_CONFLICT]: 400,
    [ERROR_CODES.INPUT_MAPPING_FAILED]: 400,
    [ERROR_CODES.INVALID_PAYLOAD_FORMAT]: 400,
    [ERROR_CODES.INVITATION_EXPIRED]: 400,
    [ERROR_CODES.CANNOT_REMOVE_LAST_OWNER]: 400,
    [ERROR_CODES.PLAN_FEATURE_REQUIRED]: 403,
    [ERROR_CODES.PASSWORD_TOO_COMMON]: 400,
    [ERROR_CODES.UNKNOWN_ENV_VARIABLE]: 400,
    [ERROR_CODES.BODY_ON_GET_HEAD]: 400,
    [ERROR_CODES.FORBIDDEN_REPLY_HEADER]: 400,
    [ERROR_CODES.HOST_NOT_ALLOWED]: 400,
    [ERROR_CODES.REPLY_IN_NON_WEBHOOK]: 400,
    [ERROR_CODES.MULTIPLE_REPLY_STEPS]: 400,
    [ERROR_CODES.EVENT_TRIGGER_NOT_SUPPORTED]: 400,
    [ERROR_CODES.PARALLEL_NOT_SUPPORTED]: 400,
    [ERROR_CODES.NESTING_TOO_DEEP]: 400,
    [ERROR_CODES.APPROVAL_ALREADY_DECIDED]: 409,
    [ERROR_CODES.CREDENTIAL_IN_USE]: 409,
    [ERROR_CODES.INVALID_STATE]: 400,
    [ERROR_CODES.INVALID_NONCE]: 400,
    [ERROR_CODES.CONFLICT]: 409,
    [ERROR_CODES.INTERNAL_ERROR]: 500,
  };
  return map[code] ?? 400;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError;
}
