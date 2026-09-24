import { api, setCsrfToken, type LoginResponse, type SelectWorkspaceResponse } from './api';

/**
 * Extend an internal `next` path with the query params that rode beside it
 * (e.g. `/invite?token=…` → `/login?next=/invite&token=…`). Without this the
 * one-time invitation secret is dropped by the sign-in hop and the visitor
 * lands on /invite with a missing token (§8.2 invite acceptance).
 */
export function nextWithPreservedParams(next: string, params: URLSearchParams): string {
  const extra = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key !== 'next' && value) extra.append(key, value);
  }
  if (extra.size === 0) return next;
  return `${next}${next.includes('?') ? '&' : '?'}${extra.toString()}`;
}

/**
 * Post login/register flow (§8.1): the server returns a pre-workspace session
 * plus the account's workspace list. With exactly one workspace we select it
 * immediately (no dead clicks); with several we route to the picker page;
 * with none we surface the server's contract violation as an error.
 *
 * Returns the path to navigate to.
 */
export async function completeWorkspaceSelection(login: LoginResponse): Promise<string> {
  setCsrfToken(login.csrf_token);
  const workspaces = login.workspaces ?? [];
  if (workspaces.length === 0) {
    throw new Error('This account has no workspaces');
  }
  if (workspaces.length > 1) {
    return '/select-workspace';
  }
  const slug = workspaces[0].slug;
  if (!slug) {
    throw new Error('Workspace has no slug');
  }
  const res = await api.post<{ data: SelectWorkspaceResponse }>('/auth/select-workspace', {
    workspace_slug: slug,
  });
  setCsrfToken(res.data.csrf_token);
  return '/dashboard';
}
