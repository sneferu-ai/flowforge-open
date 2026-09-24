/**
 * Crypto utilities — AES-256-GCM for credential/secret encryption.
 *
 * Per-workspace data keys via HKDF-SHA256(FF_VAULT_KEY, salt=workspace_id,
 * info="flowforge-vault-v1", length=32) per spec §8.3.
 *
 * Master key from FF_VAULT_KEY (§4.4, 32-byte base64) with
 * FF_ENCRYPTION_KEY accepted as a compatibility alias.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  hkdfSync,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const TAG_LENGTH = 16;
const HKDF_INFO = 'flowforge-vault-v1';
const HKDF_LENGTH = 32;

/**
 * Resolve the raw master key material from FF_VAULT_KEY (or FF_ENCRYPTION_KEY alias).
 * Throws if no key is configured — the deterministic fallback is removed (§8.3).
 */
function getMasterKeyMaterial(): Buffer {
  const envKey = process.env.FF_VAULT_KEY || process.env.FF_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error('FF_VAULT_KEY is required for vault encryption (§8.3). Set a 32-byte base64 or hex key.');
  }
  if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, 'hex');
  }
  const decoded = Buffer.from(envKey, 'base64');
  if (decoded.length === 32) return decoded;
  const buf = Buffer.from(envKey, 'utf-8');
  if (buf.length >= 32) return buf.subarray(0, 32);
  const padded = Buffer.alloc(32);
  buf.copy(padded);
  return padded;
}

/**
 * Derive a per-workspace AES-256 key via HKDF-SHA256.
 * salt = workspace_id, info = "flowforge-vault-v1", length = 32 bytes (§8.3).
 */
function deriveWorkspaceKey(workspaceId: string): Buffer {
  const masterKey = getMasterKeyMaterial();
  const derived = hkdfSync('sha256', masterKey, workspaceId, HKDF_INFO, HKDF_LENGTH);
  return Buffer.from(derived);
}

/**
 * The vault key version written with each new encryption (§8.3). A rotation
 * deploys FF_VAULT_KEY_VERSION=N alongside FF_VAULT_KEY (new) +
 * FF_VAULT_KEY_OLD (previous); the rotation script re-encrypts rows whose
 * key_version lags and bumps the column. Monotonically increasing.
 */
export function getCurrentKeyVersion(): number {
  const raw = process.env.FF_VAULT_KEY_VERSION;
  if (!raw) return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export interface EncryptionResult {
  /** base64(iv || tag || ciphertext) — stored in the *_enc column. */
  valueEnc: string;
  /** base64(iv) — also stored in the row's nonce column for rotation tracking. */
  nonce: string;
  /** Vault key version used for this encryption. */
  keyVersion: number;
}

/**
 * Encrypt a plaintext string with a per-workspace derived key, returning the
 * nonce and key version alongside the sealed value so callers can persist the
 * §8.3 rotation columns (nonce, key_version).
 */
export function encryptWithMeta(plaintext: string, workspaceId: string): EncryptionResult {
  const key = deriveWorkspaceKey(workspaceId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    valueEnc: Buffer.concat([iv, tag, ciphertext]).toString('base64'),
    nonce: iv.toString('base64'),
    keyVersion: getCurrentKeyVersion(),
  };
}

/**
 * Encrypt a plaintext string with a per-workspace derived key.
 * Returns base64(iv || tag || ciphertext).
 */
export function encrypt(plaintext: string, workspaceId: string): string {
  return encryptWithMeta(plaintext, workspaceId).valueEnc;
}

/**
 * Decrypt a base64(iv || tag || ciphertext) string with a per-workspace derived key.
 */
export function decrypt(encrypted: string, workspaceId: string): string {
  const key = deriveWorkspaceKey(workspaceId);
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf-8');
}

/**
 * Constant-time string comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}

/**
 * HMAC-SHA256 for webhook signature verification.
 */
export function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf-8').digest('hex');
}

/**
 * HMAC-SHA256 using Web Crypto API (async, for browser-compatible code).
 */
export async function hmacSha256Async(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
