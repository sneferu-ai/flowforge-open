/**
 * OIDC cryptographic helpers (§8.6) — base64url JWT coding, HS256 signing for
 * the mock IdP, and id_token verification for HS256 / RS256 / ES256.
 *
 * - Mock IdP: HS256 with FF_OIDC_SIGNING_KEY (32-byte base64 per §4.4).
 * - Real IdPs: RS256/ES256 — public keys resolved through an injectable
 *   `jwks` resolver (defaults to fetching `{issuer}/.well-known/jwks.json`).
 *   The RS256 path is exercised hermetically by tests/oidc-crypto.test.ts,
 *   which generates a test keypair at test time; a live round-trip requires
 *   an external IdP (§15).
 */

import {
  createHmac,
  createPublicKey,
  createVerify,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';

export function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function signingKeyBytes(): Buffer {
  const raw = process.env.FF_OIDC_SIGNING_KEY;
  if (!raw) {
    throw new Error('FF_OIDC_SIGNING_KEY is required for mock OIDC (§4.4)');
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length >= 32) return decoded.subarray(0, 32);
  return Buffer.alloc(32, raw, 'utf-8');
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  [key: string]: unknown;
}

/** Sign an id_token with HS256 (the mock IdP's algorithm, §8.6/D9). */
export function signIdTokenHs256(claims: IdTokenClaims, kid?: string): string {
  const header = { alg: 'HS256', typ: 'JWT', ...(kid ? { kid } : {}) };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = createHmac('sha256', signingKeyBytes()).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/** JWKS public-key resolver — injectable for tests with the bundled keypair. */
export type JwksResolver = (issuer: string, kid?: string) => Promise<{ kid: string; pem: string } | null>;

const DEFAULT_JWKS_RESOLVER: JwksResolver = async (issuer, kid) => {
  const discoveryUrl = new URL('/.well-known/jwks.json', issuer.endsWith('/') ? issuer : `${issuer}/`);
  const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const jwks = (await res.json()) as { keys?: JwkKey[] };
  let key = jwks.keys?.find((k) => (kid ? k.kid === kid : true));
  if (!key && jwks.keys?.length) key = jwks.keys[0];
  if (!key) return null;
  return { kid: key.kid ?? '', pem: jwkToSpkiPem(key) };
};

/** Minimal JWK shape supported for id_token verification (RSA / EC-P256). */
export interface JwkKey {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  [key: string]: unknown;
}

/** JWK (RSA or EC) → SPKI PEM via Node's native JWK import. */
function jwkToSpkiPem(key: JwkKey): string {
  const publicKey = createPublicKey({ key, format: 'jwk' });
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

export interface VerifyIdTokenOptions {
  issuer: string;
  audience: string;
  expectedNonce: string;
  /** Resolver override — tests inject the bundled RS256 keypair. */
  jwks?: JwksResolver;
  nowMs?: number;
}

export class OidcTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcTokenError';
  }
}

/**
 * Verify an id_token and return its claims. Fails loudly (OidcTokenError) on
 * malformed tokens, alg confusion (only HS256/RS256/ES256 accepted), bad
 * signatures, `iss`/`aud`/`nonce` mismatch, or expiry with clock skew ≤ 60s.
 */
export async function verifyIdToken(token: string, opts: VerifyIdTokenOptions): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcTokenError('id_token is not a JWT');
  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf-8')) as { alg?: string; kid?: string };
    claims = JSON.parse(base64UrlDecode(parts[1]).toString('utf-8')) as IdTokenClaims;
  } catch {
    throw new OidcTokenError('id_token header/claims are not valid JSON');
  }
  const alg = header.alg;
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);

  if (alg === 'HS256') {
    const expected = createHmac('sha256', signingKeyBytes()).update(signingInput).digest();
    if (signature.length !== expected.length || !nodeTimingSafeEqual(signature, expected)) {
      throw new OidcTokenError('id_token signature check failed');
    }
  } else if (alg === 'RS256' || alg === 'ES256') {
    const jwks = opts.jwks ?? DEFAULT_JWKS_RESOLVER;
    const key = await jwks(opts.issuer, header.kid);
    if (!key) throw new OidcTokenError('no matching JWKS key for id_token');
    const algName = alg === 'RS256' ? 'RSA-SHA256' : 'sha256';
    let ok = false;
    try {
      ok = createVerify(algName).update(signingInput).verify(key.pem, signature);
    } catch {
      ok = false;
    }
    if (!ok) throw new OidcTokenError('id_token signature check failed');
  } else {
    throw new OidcTokenError(`unsupported id_token algorithm: ${String(alg)}`);
  }

  const nowMs = opts.nowMs ?? Date.now();
  const nowS = Math.floor(nowMs / 1000);
  if (!claims.iss || claims.iss !== opts.issuer) throw new OidcTokenError('id_token iss mismatch');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(opts.audience)) throw new OidcTokenError('id_token aud mismatch');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < nowS) throw new OidcTokenError('id_token expired');
  if (opts.expectedNonce && claims.nonce !== opts.expectedNonce) throw new OidcTokenError('id_token nonce mismatch');
  return claims;
}
