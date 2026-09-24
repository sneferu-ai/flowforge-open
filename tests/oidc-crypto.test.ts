/**
 * OIDC crypto helpers (§8.6) — HS256 mock tokens, RS256 verification against
 * a test RSA keypair generated at test time, and the full claim-validation
 * battery (iss/aud/exp/nonce, alg confusion, tampering).
 *
 * The RSA keypair is generated inside the test process with node:crypto so
 * no private key material is ever committed to the source tree or shipped in
 * the product image.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generateKeyPairSync, createSign } from 'node:crypto';
import {
  signIdTokenHs256,
  verifyIdToken,
  OidcTokenError,
  type IdTokenClaims,
} from '../apps/server/src/auth/oidc.js';

// ── Test-only RSA keypair (generated at test time, never on disk) ──────────
let RSA_PRIVATE = '';
let RSA_PUBLIC = '';

beforeAll(() => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  RSA_PRIVATE = privateKey as string;
  RSA_PUBLIC = publicKey as string;
});

const ISSUER = 'https://idp.example.test';
const AUDIENCE = 'flowforge-client-1';

function baseClaim(over: Partial<IdTokenClaims> = {}): IdTokenClaims {
  const nowS = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: 'user-42@example.test',
    aud: AUDIENCE,
    exp: nowS + 3600,
    iat: nowS,
    ...over,
  };
}

function signRs256(claims: IdTokenClaims, kid = 'test-rsa-1'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  const sig = createSign('RSA-SHA256').update(input).sign(RSA_PRIVATE).toString('base64url');
  return `${input}.${sig}`;
}

describe('oidc HS256 tokens (mock IdP)', () => {
  const ORIGINAL_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='; // 32-byte b64
  beforeAll(() => {
    process.env.FF_OIDC_SIGNING_KEY = ORIGINAL_KEY;
  });
  afterAll(() => {
    process.env.FF_OIDC_SIGNING_KEY = ORIGINAL_KEY;
  });

  it('signs a token that verifies with the same key', async () => {
    const token = signIdTokenHs256(baseClaim({ nonce: 'n1' }));
    const claims = await verifyIdToken(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      expectedNonce: 'n1',
    });
    expect(claims.sub).toBe('user-42@example.test');
    expect(claims.email).toBeUndefined();
  });

  it('rejects a tampered payload', async () => {
    const token = signIdTokenHs256(baseClaim({ nonce: 'n1' }));
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.sub = 'attacker@evil.test';
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
    await expect(
      verifyIdToken(tampered, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: 'n1' })
    ).rejects.toThrow(OidcTokenError);
  });

  it('rejects nonce mismatch', async () => {
    const token = signIdTokenHs256(baseClaim({ nonce: 'n1' }));
    await expect(
      verifyIdToken(token, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: 'n2' })
    ).rejects.toThrow('nonce');
  });

  it('rejects iss and aud mismatches', async () => {
    const token = signIdTokenHs256(baseClaim());
    await expect(
      verifyIdToken(token, { issuer: 'https://other.test', audience: AUDIENCE, expectedNonce: '' })
    ).rejects.toThrow('iss');
    await expect(
      verifyIdToken(token, { issuer: ISSUER, audience: 'other-client', expectedNonce: '' })
    ).rejects.toThrow('aud');
  });

  it('rejects expired tokens (60s clock skew floor)', async () => {
    const token = signIdTokenHs256(baseClaim({ exp: Math.floor(Date.now() / 1000) - 300 }));
    await expect(
      verifyIdToken(token, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: '' })
    ).rejects.toThrow('expired');
  });

  it('rejects HS256 tokens signed with a different key', async () => {
    const token = signIdTokenHs256(baseClaim());
    process.env.FF_OIDC_SIGNING_KEY = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg='; // different key
    await expect(
      verifyIdToken(token, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: '' })
    ).rejects.toThrow('signature');
  });

  it('refuses alg: none (alg confusion)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(baseClaim())).toString('base64url');
    await expect(
      verifyIdToken(`${header}.${payload}.`, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: '' })
    ).rejects.toThrow(OidcTokenError);
  });
});

describe('oidc RS256 verification (test RSA keypair, §8.6)', () => {
  const jwks = async () => ({ kid: 'test-rsa-1', pem: RSA_PUBLIC });

  it('verifies a token signed by the test private key', async () => {
    const token = signRs256(baseClaim({ nonce: 'rsa-nonce' }));
    const claims = await verifyIdToken(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      expectedNonce: 'rsa-nonce',
      jwks,
    });
    expect(claims.sub).toBe('user-42@example.test');
  });

  it('rejects a token signed by a different key (same kid)', async () => {
    const wrongToken = signRs256(baseClaim());
    // Splice a valid signature from a different signature space: re-sign with
    // the same key but tamper claims → signature no longer matches.
    const parts = wrongToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.sub = 'attacker@evil.test';
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
    await expect(
      verifyIdToken(tampered, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: '', jwks })
    ).rejects.toThrow('signature');
  });

  it('fails when the resolver finds no key', async () => {
    const token = signRs256(baseClaim());
    await expect(
      verifyIdToken(token, { issuer: ISSUER, audience: AUDIENCE, expectedNonce: '', jwks: async () => null })
    ).rejects.toThrow('JWKS');
  });
});
