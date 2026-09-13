# MR-13 checkpoint: shared dashboard authentication

Verified: 2026-09-13

MR-13 replaces process-local operator authentication state with an optional
Postgres-backed encrypted store suitable for multiple instances. Opaque lookup
identifiers are SHA-256 hashed and every session, login challenge, and OIDC
transaction is encrypted with AES-256-GCM. A key ring permits reads with an old
key while all new records use the configured active key. Storage and decryption
failures deny access instead of falling back to process memory.

The dashboard now has an SSO-ready OIDC boundary with authorization-code PKCE,
single-use state, nonce, exact configured client/redirect values, issuer and
audience validation, token expiry, and explicit claim-to-dashboard-role mapping.
The provider adapter must return cryptographically verified claims; this change
does not add a live identity-provider client. Local token login is now a separate
explicit fallback and remains disabled by default.

Authentication events persist only operator UUID (when known), event, outcome,
method, reason code, timestamp, and validated/generated correlation UUID. Tokens,
claims, state, nonce, browser identifiers, and traveler data are not retained.
Retention is enforced after writes using the configured day window.

## Deployment and key rotation

1. Apply migration `022_operator_dashboard_security.sql`.
2. Keep all secrets in the deployment secret manager, never in source control.
3. Set `HUMAN_HANDOFF_DASHBOARD_SESSION_STORE=postgres` and provide
   `HUMAN_HANDOFF_DASHBOARD_SESSION_KEYS_JSON` as an array of `{id,keyBase64}`
   entries containing 32-byte random keys.
4. Set `HUMAN_HANDOFF_DASHBOARD_ACTIVE_KEY_ID` to one entry in that ring.
5. To rotate, deploy the new key alongside the old key and make the new ID
   active. Keep the old key until the maximum session and OIDC transaction TTLs
   have elapsed, then remove it. Removing it early invalidates old records safely.
6. Enable OIDC only after injecting a verified provider adapter and configuring
   HTTPS issuer, client ID, exact redirect URI, role claim, and role mapping.
   Enable local tokens separately only when the approved fallback is required.

The dashboard, OIDC, local fallback, handoff publication, alerts, native groups,
booking, payment, and traveler contact all remain disabled unless independently
configured. No booking/payment/native-group/publication/alert/traveler-contact
capability was added or enabled here.

## Verification

Verification completed with 19 focused authentication/dashboard tests passing,
the TypeScript build passing, and static validation finding all 32 tables and 35
required indexes. The full suite passed 959 tests; five Redis-dependent tests
failed because Redis was unavailable, and the Postgres repository suite could
not initialize because Postgres was unavailable. Diff review and secret scanning
also completed without an MR-13 defect or exposed credential.
Real IdP and controlled-staging browser runs remain blocked until an approved IdP,
staging database, and browser matrix are supplied; the provider-neutral boundary
and deterministic accessibility/security behavior are covered locally.

## MR-14 boundary

MR-14 may integrate one explicitly approved OIDC provider and execute the
controlled staging/browser matrix. It must not expand into booking, payment,
native groups, external publication/alerts, or traveler contact without separate
approval.
