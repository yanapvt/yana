# Post-MR tourist-journey audit

Audit date: 2026-09-14  
Baseline: `e79d2a0` (`feat: add handoff launch validation boundary`)

This audit made no runtime repairs and used no real traveler, booking, payment,
identity, staff, alert, or supplier endpoint. MR-14 remains a distinct published
checkpoint. Findings below are the repair backlog for a fresh development task.

## Evidence and scope

- 343 deterministic journey tests passed across 23 focused files: webhook and
  forms, hotel discovery/selection/near-booking, explicit unsupported-flight
  responses, airport/intercity logistics, restaurants, excursions, itinerary
  generation/edit/resume, pagination, reset, voice transcription, Twilio/OpenWA/
  Meta normalization and rendering, provider failures, handoff queue/operations,
  dashboard assignment/closure, and safe errors.
- The MR-14 focused launch/authentication matrix passed 55 tests across 11 files.
- Repository-wide: 967 tests passed. Five Redis-dependent tests failed while
  Redis was unavailable; the Postgres repository suite could not initialize.
- Build passed; all 32 required tables and 35 indexes passed static validation.
- Not tested live: supplier inventory, WhatsApp delivery, speech provider, IdP/
  JWKS, Postgres/Redis multi-instance failover, queue publication/alerts, browsers,
  assistive technologies, device reflow, load, deployment, backup/restore, or rollback.

## Prioritized bug and improvement register

### TJ-01 — P1: inbound duplicate protection fails open during Redis outage

- Reproduction: stop Redis and run `src/middleware/deduplication.test.ts`, or send
  the same webhook message ID twice while Redis connection/setup fails.
- Expected: a supported local/durable idempotency path prevents duplicate message
  processing, or the webhook fails closed before any repeatable side effect.
- Actual: `checkAndStoreMessageId` throws, middleware logs “Proceeding with
  processing despite deduplication failure,” and calls `next()`. The full suite
  reproduced three deduplication failures plus two StateStore Redis failures.
- Severity/risk: P1 for production messaging. Repeated replies/searches are likely;
  future non-idempotent integrations would increase impact. Durable handoff case
  creation has separate protection, but that does not cover every inbound effect.
- Affected: `src/middleware/deduplication.ts`, `src/services/StateStore.ts`, webhook entry paths.
- Repair group: add an atomic fallback appropriate to the deployment topology
  (prefer durable shared storage), define explicit fail-open/fail-closed policy by
  effect class, and add outage/concurrency/restart tests with two instances.

### TJ-02 — P1: no live launch evidence for stateful or external paths

- Reproduction: follow `docs/MR_14_DEPLOYMENT_CHECKLIST.md`; required staging
  connections, providers, browser matrix, load limits, and owners are absent.
- Expected: production approval is backed by live, sanitized artifacts for two
  instances, Postgres/Redis failover, real provider contracts, rollback, browsers,
  accessibility, load, privacy, paging, and incident response.
- Actual: only local deterministic simulation exists. The market-readiness result
  is correctly NO-GO.
- Severity/risk: P1 launch blocker, not a local-code regression.
- Affected: deployment/operations rather than one source file.
- Repair group: supply the exact inputs in `docs/MR_14_MARKET_READINESS.md`, execute
  the checklist in approved staging, attach versioned evidence, and require named sign-off.

### TJ-03 — P2: authoritative hotel recheck provenance is implicit at handoff boundary

- Reproduction: call `HumanHandoffRuntime.requestHotelHandoff` directly with a
  consented synthetic selection; the method supplies `authoritativeRecheckPassed:
  true` itself rather than accepting/verifying a recheck receipt.
- Expected: the handoff boundary consumes a short-lived, provider-issued or
  internally signed recheck result tied to hotel/rate, dates, occupancy, and time.
- Actual: the WhatsApp route normally reaches the method after `handleBookingCheck`
  returns live inventory, but the runtime API does not carry or validate that
  provenance. Another caller could accidentally bypass the route invariant.
- Severity/risk: P2 defense-in-depth and future-integration risk; no booking or
  price claim is currently performed by handoff.
- Affected: `src/routes/webhook.ts`, `src/services/handoff/HumanHandoffRuntime.ts`,
  `src/services/handoff/NearBookingHandoffService.ts`, hotel session model.
- Repair group: create a typed expiring recheck receipt, persist only safe opaque
  identifiers, validate it in the runtime/service, and test stale/mismatched/replayed receipts.

### TJ-04 — P2: OIDC adapter is not a deployable authentication integration

- Reproduction: enable OIDC configuration in a deployment. Routes still require
  an injected `OperatorOidcService`; no approved IdP discovery/JWKS verifier is wired.
- Expected: one reviewed provider integration verifies signature, allowed
  algorithms, issuer/audience/nonce/expiry, key refresh/rotation, logout/revocation,
  and safe failures end to end.
- Actual: PKCE/state/nonce/service behavior and the standards token-exchange adapter
  contract are tested, but cryptographic verification remains an injected boundary.
- Severity/risk: P2 feature blocker; safe default is disabled/fail closed.
- Affected: `src/services/handoff/StandardsOidcProviderAdapter.ts`,
  `src/services/handoff/OperatorOidcService.ts`, `src/routes/operatorDashboard.ts`.
- Repair group: select/approve an IdP, use a maintained JOSE/OIDC implementation,
  wire dependency construction, then test JWKS rotation, algorithms, logout, and revocation live.

### TJ-05 — P2: interrupted-session durability and provider switching lack live multi-instance proof

- Reproduction: focused route/form tests run with unavailable Postgres/Redis and
  emit repeated durable-session lookup/save/clear failures while memory fallbacks
  keep local tests passing; restart or route the next turn to another instance.
- Expected: documented flows resume consistently across restart/instance change,
  with explicit behavior when durable stores are unavailable.
- Actual: single-process synthetic resume/reset/provider-switch scenarios pass,
  but local logs show durable writes unavailable and no live cross-instance proof.
- Severity/risk: P2 continuity risk for hotel, restaurant, excursion, logistics,
  and itinerary journeys.
- Affected: `src/services/*SessionService.ts`, `src/routes/forms.ts`,
  `src/routes/webhook.ts`, Postgres repositories and Redis StateStore.
- Repair group: controlled two-instance contract tests with managed stores,
  failure-mode policy per state, restart tests, and sanitized structured logging.

### TJ-06 — P2: browser/accessibility behavior is statically tested, not browser-tested

- Reproduction: inspect dashboard tests; they assert HTML/CSS/JS strings and HTTP
  behavior but do not run Chrome/Edge/Firefox/Safari, axe, or a screen reader.
- Expected: keyboard focus order/return, dialog trapping, labels/names, live regions,
  zoom/reflow, contrast, reduced motion, mobile layout, expiry/reconnect, and SSO
  failures are executed in the approved browser/device matrix.
- Actual: semantic markup, safe `textContent`, CSP, 360px CSS intent, roles, CSRF,
  and logout are covered locally; interaction and rendering behavior are unverified.
- Severity/risk: P2 operator usability/accessibility launch blocker.
- Affected: `src/routes/operatorDashboard.ts` and its tests.
- Repair group: add Playwright plus axe with pinned browsers, keyboard/focus tests,
  visual/reflow artifacts, and a manual assistive-technology checklist.

### TJ-07 — P3: flight requests are intentionally unsupported, not a flight journey

- Reproduction: send “Find me a return flight from London to Colombo.”
- Expected: if flights are in launch scope, collect criteria and query an approved
  authoritative provider without claiming or purchasing until separately authorized.
- Actual: YANA honestly declines flight search/booking and directs the traveler to
  an airline/trusted platform; airport transfer messages containing a flight number
  correctly remain in logistics.
- Severity/risk: P3 product gap, not a safety defect.
- Affected: `src/routes/webhook.ts`; example-only flight adapters are not runtime code.
- Repair group: product decision first, then supplier-neutral contracts, provider
  authorization, normalization, disclosure, pagination, failure, and no-purchase tests.

### TJ-08 — P3: near-booking human handoff is hotel-only

- Reproduction: select restaurant, excursion, or logistics options and proceed;
  these flows use reservation/booking placeholders rather than the consented human
  handoff lifecycle available for hotels.
- Expected: if operations promise concierge completion across verticals, each uses
  explicit consent, minimum-data summaries, idempotent case creation, and safe closure.
- Actual: discovery/forms/pagination/voice flows work, but the durable operator
  handoff workflow is not generalized beyond hotels.
- Severity/risk: P3 product consistency gap.
- Affected: webhook vertical flows, service request/session models, handoff summary types.
- Repair group: decide supported verticals, generalize typed handoff summaries,
  then add one end-to-end consent/assignment/closure contract per approved vertical.

### TJ-09 — P3: infrastructure-dependent tests are noisy and non-hermetic

- Reproduction: run `npm.cmd test` without local Redis/Postgres.
- Expected: unit suite is hermetic; integration suites detect prerequisites and
  skip with a clear reason or run via a controlled test container profile.
- Actual: 967 tests pass, but five Redis tests fail, repository setup/cleanup both
  fail, and route/form tests print large repeated connection stacks.
- Severity/risk: P3 developer confidence and CI signal quality.
- Affected: `src/services/StateStore.test.ts`, `src/middleware/deduplication.test.ts`,
  `src/db/repositories/repositories.test.ts`, session repositories/logging.
- Repair group: split unit/integration commands, provision disposable dependencies,
  add prerequisite guards, and collapse connection failures into redacted structured events.

## Suggested repair sequencing

1. Reliability/safety: TJ-01 and TJ-03.
2. Test infrastructure and continuity proof: TJ-09 and TJ-05.
3. Authentication and operator UX launch gates: TJ-04 and TJ-06.
4. Live staging/go-no-go evidence: TJ-02.
5. Product-scope improvements after approval: TJ-07 and TJ-08.

Do not combine flight or multi-vertical expansion with the reliability repair.
Keep booking, payment, publication, alerts, native groups, and traveler contact
disabled unless separately approved and verified.
