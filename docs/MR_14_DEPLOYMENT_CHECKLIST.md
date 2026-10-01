# MR-14 deployment, operations, and go/no-go checklist

This is a human-reviewed staging checklist, not an executable deployment and not
evidence that any external system is healthy. Begin with every capability off in
`deploy/handoff-staging.env.example` and enable one boundary at a time.

## Infrastructure and deployment

- [ ] Approved staging project, owner, region, DNS name, and rollback revision recorded.
- [ ] Postgres and Redis are private, encrypted, backed up, monitored, and reachable from at least two application instances.
- [ ] Migration 022 has been applied and the migration ledger backed up.
- [ ] Dashboard keys, database/Redis credentials, and provider credentials are injected from a secret manager with least privilege.
- [ ] Two application instances share Postgres sessions; neither silently falls back to memory when `SESSION_STORE=postgres`.
- [ ] Queue worker IDs are unique, lease/backoff limits are reviewed, and staff publication and alerts remain independently gated.
- [ ] Readiness, queue depth/age, dead letters, provider failures, and authentication failures reach an approved operator dashboard.

## OIDC and operator access

- [ ] IdP owner approves issuer, authorization/token/JWKS endpoints, client ID, exact HTTPS callback, logout behavior, and allowed origins.
- [ ] A reviewed verifier validates signature against refreshed JWKS plus algorithm, issuer, audience, expiry, and nonce before returning claims.
- [ ] Role mapping is deny-by-default and tested with viewer, operator, admin, missing, malformed, and excess-role claims.
- [ ] PKCE, state replay, nonce mismatch, expired tokens/sessions, revoked local identity, logout, instance restart, and key rollover pass.
- [ ] Local-token fallback is either explicitly approved/enabled or remains off.

## Synthetic journey and resilience

- [ ] Only synthetic markers are used; no traveler identifier, copied log, booking token, or payment data enters staging.
- [ ] No-consent creates no case; explicit consent creates one minimal case; assignment is role-scoped; closure creates no booking/payment/contact.
- [ ] Concurrent instances do not duplicate a case or publication.
- [ ] Redis/Postgres/provider outages fail safely; retry, lease recovery, dead-letter replay, and recovery produce no duplicate external delivery.
- [ ] Load targets, duration, concurrency, latency/error thresholds, and abort conditions are approved before execution.

## Browser and accessibility matrix

- [ ] Latest stable Chrome, Edge, Firefox, and Safari are exercised at desktop and 360px mobile widths.
- [ ] Login, SSO failure, lists, dialog, assignment, closure, replay, logout, expiry, and reconnect flows are keyboard-only operable.
- [ ] Visible focus, logical focus return, accessible names, label associations, headings, dialog semantics, live regions, zoom/reflow, contrast, and reduced motion pass.
- [ ] Automated axe/WCAG checks and a manual screen-reader smoke test are attached as artifacts with browser versions.

## Rollback, incident, privacy, and support

- [ ] Rollback disables dashboard/OIDC/workers/publication/alerts before reverting application code; migration 022 is retained unless a reviewed data migration says otherwise.
- [ ] Incident owner, severity path, status channel, evidence location, and decision authority are named.
- [ ] Provider or credential compromise disables only that provider; revoke/replace secrets, invalidate sessions, retain old encryption keys only for the approved drain window, then remove them.
- [ ] Auth-event retention and deletion are verified; logs exclude credentials, raw claims, traveler data, provider bodies, and opaque session IDs.
- [ ] Support has safe correlation-ID lookup instructions and cannot replay dead letters without admin role plus CSRF confirmation.

## Go/no-go

Go requires every item above, clean build/migrations/tests/security review, live
staging evidence, named operational ownership, approved rollback, and zero open
critical/high findings. Any missing IdP verifier, infrastructure test, browser
matrix, provider approval, privacy sign-off, or incident owner is a no-go.
