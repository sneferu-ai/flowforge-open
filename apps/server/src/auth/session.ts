/**
 * Session management — opaque 256-bit tokens with HMAC-based CSRF (§8.1).
 *
 * CSRF token = first 32 hex chars of HMAC-SHA256(FF_SESSION_SECRET, session_token).
 * Stored as csrf_token_hash (SHA-256 of the CSRF token) in sessions.
 * The session token (cookie value) is looked up via token_hash (SHA-256 of token).
 */

import { randomBytes, createHash, createHmac, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { query } from '../db/pool.js';

const SESSION_COOKIE = 'ff_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionData {
  id: string;
  user_id: string;
  workspace_id: string | null;
  expires_at: string;
}

export interface CreatedSession extends SessionData {
  /** Opaque 256-bit session token — set as the cookie value, never stored in the DB. */
  token: string;
  /** CSRF token returned to the client; derived from the session token via HMAC. */
  csrf_token: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

function computeCsrfToken(sessionToken: string): string {
  const secret = process.env.FF_SESSION_SECRET || '';
  if (!secret) {
    throw new Error('FF_SESSION_SECRET is required for CSRF token generation');
  }
  return createHmac('sha256', secret).update(sessionToken, 'utf-8').digest('hex').slice(0, 32);
}

export async function createSession(userId: string, workspaceId: string | null): Promise<CreatedSession> {
  const token = randomBytes(32).toString('hex'); // 256-bit opaque token
  const tokenHash = sha256Hex(token);
  const csrfToken = computeCsrfToken(token);
  const csrfTokenHash = sha256Hex(csrfToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  const result = await query<{ id: string; user_id: string; workspace_id: string | null; expires_at: string }>(
    `INSERT INTO sessions (user_id, workspace_id, token_hash, csrf_token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, workspace_id, expires_at::text`,
    [userId, workspaceId, tokenHash, csrfTokenHash, expiresAt]
  );

  return { ...result.rows[0], token, csrf_token: csrfToken };
}

export async function getSession(sessionToken: string): Promise<SessionData | null> {
  const tokenHash = sha256Hex(sessionToken);
  const result = await query<{ id: string; user_id: string; workspace_id: string | null; expires_at: string }>(
    `SELECT id, user_id, workspace_id, expires_at::text
     FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );

  // Sliding session: extend expires_at on each authenticated request (§8.1).
  if (result.rows.length > 0) {
    const newExpires = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    await query('UPDATE sessions SET expires_at = $1 WHERE id = $2', [newExpires, result.rows[0].id]);
  }

  return result.rows[0] ?? null;
}

export async function revokeSession(sessionToken: string): Promise<void> {
  const tokenHash = sha256Hex(sessionToken);
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [tokenHash]);
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getSessionDuration(): number {
  return SESSION_DURATION_MS;
}

/**
 * Validate a CSRF token against the session token (cookie value).
 * Computes the expected CSRF token from the session token via HMAC-SHA256,
 * then compares the SHA-256 hash of the provided token against the stored hash.
 */
export async function isCsrfValid(sessionToken: string, providedToken: string | undefined): Promise<boolean> {
  if (!providedToken) return false;
  const expectedCsrf = computeCsrfToken(sessionToken);
  // Timing-safe comparison of the expected CSRF token with the provided one.
  const bufA = Buffer.from(expectedCsrf, 'utf-8');
  const bufB = Buffer.from(providedToken, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}
