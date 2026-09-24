import { api, setBearerToken, clearBearerToken, setCsrfToken, type MeResponse, type SelectWorkspaceResponse } from './api';

const BOOTSTRAP_KEY = 'sneferu.preview.bootstrap.v1';

interface BootstrapRecord {
  username: string;
  role: string;
  session_token?: string;
}

/**
 * Sneferu preview bootstrap (§Preview authentication contract).
 *
 * On startup, consume the versioned client bootstrap record from localStorage
 * when present. If it carries a `session_token`, use it as a Bearer token to
 * authenticate against the real API — the same `/auth/me` flow the normal
 * login uses, just with a different credential source.
 *
 * Do NOT invent a second preview identity. Do NOT hard-code a username.
 * Normal deployed login still works when the bootstrap record is absent.
 */
export function readBootstrap(): BootstrapRecord | null {
  try {
    const raw = localStorage.getItem(BOOTSTRAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BootstrapRecord;
    if (!parsed || typeof parsed.username !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearBootstrap(): void {
  try {
    localStorage.removeItem(BOOTSTRAP_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * If a bootstrap record with a session_token exists, set the Bearer token
 * and verify the session is live via /auth/me. Returns the auth result or
 * null if no bootstrap is present.
 */
export async function tryBootstrapAuth(): Promise<{
  me: MeResponse;
  path: string;
} | null> {
  const record = readBootstrap();
  if (!record || !record.session_token) return null;

  setBearerToken(record.session_token);

  try {
    const res = await api.get<{ data: MeResponse }>('/auth/me');
    const me = res.data;
    if (!me) return null;

    if (me.csrf_token) {
      setCsrfToken(me.csrf_token);
    }

    /* Already in a workspace — go straight to dashboard */
    if (me.workspace && me.workspace.slug) {
      return { me, path: '/dashboard' };
    }

    /* Pre-workspace — auto-select if exactly one workspace */
    if (me.workspaces && me.workspaces.length === 1) {
      const slug = me.workspaces[0].slug;
      if (slug) {
        const wsRes = await api.post<{ data: SelectWorkspaceResponse }>(
          '/auth/select-workspace',
          { workspace_slug: slug },
        );
        if (wsRes.data.csrf_token) {
          setCsrfToken(wsRes.data.csrf_token);
        }
        return { me: { ...me, workspace: wsRes.data.workspace, role: wsRes.data.role }, path: '/dashboard' };
      }
    }

    /* Multiple workspaces or no slug — go to picker */
    return { me, path: '/select-workspace' };
  } catch {
    clearBearerToken();
    return null;
  }
}
