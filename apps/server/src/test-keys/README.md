# Test-only RSA keypair

The OIDC RS256 verification test (`tests/oidc-crypto.test.ts`) generates a
fresh RSA-2048 keypair **at test time** using `node:crypto.generateKeyPairSync`.
No private key material is committed to the repository or shipped in the
product image.

- These keys are **never** used in production. Production OIDC verification
  fetches real JWKS keys from the provider's `.well-known/jwks.json`.
- If you need a persistent keypair for manual testing, generate one locally:

```sh
openssl genrsa -out /tmp/rsa-test-private.pem 2048
openssl rsa -in /tmp/rsa-test-private.pem -pubout -out /tmp/rsa-test-public.pem
```

Do **not** commit generated PEM files to the repository.
