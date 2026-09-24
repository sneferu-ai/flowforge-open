-- Migration: 006_repair_schema_alignment.sql
-- Converges databases created under the pre-repair 001–005 revisions onto the
-- spec §6.2/§7/§8.1/§8.3 shapes. Idempotent; a no-op on fresh databases where
-- 001 already carries the repaired definitions.

-- 1. run_steps uniqueness is (run_id, step_path, attempt) — retries and crash
--    recovery re-insert the same step/iteration with a higher attempt (§6.2).
--    The original 001 also created an iteration-based unique index that made
--    legal retries collide; drop it.
DROP INDEX IF EXISTS idx_run_steps_unique;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_run_steps_path_attempt ON run_steps (run_id, step_path, attempt);

-- 2. Vault rotation columns (§8.3): encrypted secret tables track the nonce
--    (AES-GCM IV) and the key version used for each row.
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS nonce TEXT;
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE webhook_secrets ADD COLUMN IF NOT EXISTS nonce TEXT;
ALTER TABLE webhook_secrets ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS client_secret_nonce TEXT;
ALTER TABLE oidc_providers ADD COLUMN IF NOT EXISTS client_secret_key_version INTEGER NOT NULL DEFAULT 1;

-- Backfill the nonce from the embedded IV (value_enc = base64(iv || tag || ciphertext)).
UPDATE credentials
SET nonce = encode(substring(decode(value_enc, 'base64') from 1 for 12), 'base64')
WHERE nonce IS NULL;
UPDATE webhook_secrets
SET nonce = encode(substring(decode(value_enc, 'base64') from 1 for 12), 'base64')
WHERE nonce IS NULL;
UPDATE oidc_providers
SET client_secret_nonce = encode(substring(decode(client_secret_enc, 'base64') from 1 for 12), 'base64')
WHERE client_secret_nonce IS NULL;

-- 3. Invitations store a SHA-256 token hash, never the plaintext token (§7).
--    Existing rows carry the raw UUID token; hash it in place so outstanding
--    invitation links keep working, then move the primary key to id.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS id UUID;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS token_hash TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

UPDATE invitations SET id = gen_random_uuid() WHERE id IS NULL;
-- Pre-repair rows stored the raw token in the primary-key column (named
-- "token"); hash those values so the row no longer carries the secret.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invitations' AND column_name = 'token'
  ) THEN
    UPDATE invitations SET token_hash = encode(digest(token::text, 'sha256'), 'hex') WHERE token_hash IS NULL;
    ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_pkey;
    ALTER TABLE invitations DROP COLUMN token;
  END IF;
END $$;

ALTER TABLE invitations ALTER COLUMN id SET NOT NULL;
ALTER TABLE invitations ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE invitations ALTER COLUMN token_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitations_pkey') THEN
    ALTER TABLE invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_key ON invitations (token_hash);

-- 4. Login rate limiting (§8.1): 5 failed attempts per email per 15 minutes
--    locks the account for 15 minutes (HTTP 423).
CREATE TABLE IF NOT EXISTS login_attempts (
    email TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('006_repair_schema_alignment')
ON CONFLICT DO NOTHING;
