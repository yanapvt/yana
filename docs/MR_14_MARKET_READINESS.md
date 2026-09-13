# YANA market-readiness assessment

Assessment date: 2026-09-14

Decision: **NO-GO for production/market launch.** The repository has a strong,
disabled-by-default handoff control plane, but live infrastructure, provider,
browser/accessibility, security, privacy, load, and operational evidence is not
available in this workspace. “Implemented” and “locally simulated” do not satisfy
the live launch gate.

## Evidence classification

| Classification | Evidence |
| --- | --- |
| Verified code | Consent/minimal-data gates, durable idempotent cases, leased queue, role/CSRF dashboard, encrypted shared-session adapter, key ring, OIDC state/nonce/PKCE boundary, persistent minimized auth events, safe feature defaults. |
| Simulated locally | Synthetic scenario matrix contract, multi-instance shared-store behavior, session expiry/revocation, key rollover, queue contention/retry/dead-letter/provider-failure recovery, safe UI semantics and injection resistance. |
| Requires live staging | Managed Postgres/Redis failover and load, two deployed instances, migration/rollback, real queue/provider delivery, real OIDC/JWKS verification, browser/device/assistive-technology matrix, observability paging, backup/restore and incident exercise. |
| External blockers | Approved IdP/provider choices and owners, credentials/endpoints, staging target, privacy/security approval, traffic/load limits, browser matrix, on-call/support ownership, launch acceptance thresholds. |

## MR-01 through MR-14 summary

1. Supplier-neutral hotel orchestration and disabled LiteAPI search adapter.
2. Privacy-minimized internal supplier attribution.
3. Feature-gated WhatsApp routing to authoritative suppliers.
4. SLTDA registered-accommodation eligibility gate.
5. Registry compatibility correction using the existing accommodation source.
6. Persistent audit of rejected unregistered inventory and separated discovery/supplier IDs.
7. Safe consented near-booking human-handoff boundary.
8. Durable handoff runtime and scoped operator controls.
9. Leased queue, retries, dead letters, and operational observability.
10. Hardened provider publication/alert boundaries and recovery controls.
11. Guarded staging-readiness drills, secret audit, and operations runbooks.
12. First-party accessible, role-scoped operator dashboard.
13. Encrypted shared sessions, key rotation, OIDC/PKCE boundary, and persistent auth telemetry.
14. Standards-oriented OIDC adapter contract, synthetic launch-validation matrix, disabled staging manifest, consolidated operational gates, and evidence-based readiness decision.

No MR completes booking, charging, cancellation, refund, or supplier settlement.
Google discovery remains non-authoritative. No live staff/alert/identity provider,
production traffic, native WhatsApp group, or traveler contact is enabled.

## Exact inputs needed for live completion

1. Staging platform/project, region, application URL, deployment owner, and rollback revision policy.
2. Managed Postgres and Redis connection bindings plus permission to run migrations, controlled failover, backup/restore, and bounded load tests.
3. Approved OIDC issuer, authorization/token/JWKS endpoints, client ID, exact callback/logout URIs, allowed signing algorithms, claim-to-role mapping, test identities, and identity/security owner approval.
4. Approved staff-publication and alert-provider endpoints, scoped staging credentials, synthetic recipient destinations, rate limits, and provider owners.
5. Browser/OS/device/assistive-technology versions, accessibility acceptance standard, and permission to retain sanitized test artifacts.
6. Approved load profile and abort thresholds; privacy retention period and sign-off; monitoring/paging destinations; incident commander, on-call, support, and launch approvers.

Until these inputs are supplied and the checklist passes with attached evidence,
YANA must remain disabled for production handoff traffic and must not be described
as market-ready.
