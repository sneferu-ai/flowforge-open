export const BASE = '/api/v1';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const CSRF_STORAGE_KEY = 'ff_csrf_token';
const BEARER_KEY = 'ff_bearer_token';

/** The CSRF token arrives in auth responses (§8.1) and must ride every
 *  state-changing request as X-CSRF-Token. */
export function setCsrfToken(token: string): void {
  try {
    sessionStorage.setItem(CSRF_STORAGE_KEY, token);
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

export function clearCsrfToken(): void {
  try {
    sessionStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function csrfToken(): string {
  try {
    return sessionStorage.getItem(CSRF_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Bearer token support — used by the Sneferu preview bootstrap to
 *  authenticate via an API token instead of the cookie-session flow. */
export function setBearerToken(token: string): void {
  try {
    sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearBearerToken(): void {
  try {
    sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* ignore */
  }
}

function bearerToken(): string {
  try {
    return sessionStorage.getItem(BEARER_KEY) ?? '';
  } catch {
    return '';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = csrfToken();
  const bearer = bearerToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (bearer) {
    headers['Authorization'] = `Bearer ${bearer}`;
  }
  if (token && options?.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText, code: 'http_error' } }));
    throw new ApiError(body.error?.message || `HTTP ${res.status}`, body.error?.code || 'http_error', res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Fetch the configured demo credentials from the root-level (non-/api/v1)
 * endpoint, so the login page can display them verbatim (§10.4).
 *
 * Deliberately raw fetch, not api.request: the endpoint lives outside the
 * /api/v1 prefix, and the response is NOT the { data, error } envelope. Any
 * failure mode — non-200, a non-JSON SPA-fallback answer, a missing field,
 * or a network error — resolves to null and the caller renders nothing.
 */
export async function fetchDemoCredentials(): Promise<{ email: string; password: string } | null> {
  try {
    const res = await fetch('/demo/credentials', { credentials: 'same-origin' });
    if (res.status !== 200) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    const body = await res.json();
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') return null;
    return { email: body.email, password: body.password };
  } catch {
    return null;
  }
}

// ---- typed payloads (server contract) --------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceInfo {
  id?: string;
  name: string;
  plan_id: string;
  slug?: string | null;
  role?: string;
}

/** §8.1: login/register return a PRE-WORKSPACE session + the workspace list;
 *  the client then exchanges it via POST /auth/select-workspace. */
export interface LoginResponse {
  id: string;
  email: string;
  name: string;
  user: AuthUser;
  workspaces: WorkspaceInfo[];
  csrf_token: string;
}

export interface SelectWorkspaceResponse {
  workspace: WorkspaceInfo;
  role: string;
  csrf_token: string;
}

export interface MeResponse {
  user: AuthUser;
  /** null while the session is pre-workspace (picker must be shown). */
  workspace: WorkspaceInfo | null;
  role: string | null;
  workspaces?: WorkspaceInfo[];
  csrf_token: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  summary: string | null;
  slug: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  current_version: number | null;
  run_count: number;
  trigger_count: number;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  summary: string | null;
  slug: string | null;
  is_enabled: boolean;
  current_version_id: string | null;
  current_version: number | null;
}

export interface RunSummary {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  trigger_id: string | null;
  recovery_count: number;
}

export interface RunDetailData {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  state: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  heartbeat_at: string | null;
  recovery_count: number;
  total_running_seconds: number;
  trigger_id: string | null;
  resume_at: string | null;
  timeout_at: string | null;
}

export interface RunStep {
  id: string;
  step_id: string;
  step_path: string;
  iteration: number;
  status: string;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  logs: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
}

export interface ApprovalTask {
  id: string;
  run_id: string;
  step_id: string;
  step_path: string;
  prompt: string;
  status: string;
  created_at: string;
  timeout_at: string;
  decided_at: string | null;
  on_timeout: string;
  workflow_id: string;
  workflow_name: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  summary: string;
  icon: string;
  workflow: string;
  manifest: string;
}

export interface DashboardData {
  workflow_count: number;
  run_count: number;
  pending_approval_count: number;
  unread_notification_count: number;
  recent_runs: RunSummary[];
  recent_workflows: WorkflowSummary[];
}
