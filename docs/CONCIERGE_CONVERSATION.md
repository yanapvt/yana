# Concierge conversation layer

The concierge opening runs on normalized Twilio, OpenWA, and Meta inbound messages, after voice transcription and before the existing profile gate and service executor. It does not execute searches, bookings, payments, or provider calls. `ConversationAnalyzer` supplies a bounded first-pass intent; the existing control plane and schema validators retain routing authority.

On the first clear request, the reply is split into two WhatsApp messages: a personal acknowledgment and the existing next step. The constrained interpreter may propose the acknowledgment and resolve a clear intent; deterministic wording remains available if interpretation fails. When intent is unclear, the first two messages acknowledge the traveller and offer three choices. A chosen service is carried into the next turn. The state is kept in Redis with the supported in-memory fallback for seven days. Existing active workflows bypass the opening. A returning greeting after an incomplete workflow receives a short invitation to continue.

The traveller memory contract includes `current_location` and `trip_destination`. The model can propose only explicit location statements; CORE validates and persists them. Current location expires after 24 hours, trip destination after 30 days. Only confirmed, unexpired current location is reused for a service request that omits a place. The validated place is saved into hotel or transport form sessions so the field is prefilled. New location values do not overwrite a user's explicit destination in the request. Migration `025_traveller_location_memory.sql` extends the database constraint; apply it after migration 024.

Weather enrichment uses the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) and [forecast API](https://open-meteo.com/en/docs). It only runs for an outdoor request with a place and a date in the next seven forecast days. It adds a rain warning at 50% or higher forecast probability, and degrades quietly if the provider is unavailable. It does not represent weather as a booking or availability guarantee. Review provider terms before enabling it for a commercial deployment.

The model writes a short personal acknowledgment for a new conversation and can recognize meaningful news in a continuing one. The backend validates that wording and retains the form, search, booking, and payment decisions. A safe fallback is used when the model is unavailable.

Unfinished form and schema reminders are scheduled 30 minutes after the last inbound message, only when both the global proactive messaging flag and the traveller's saved proactive preference are enabled. Up to three still-open requests can be mentioned in one message. A traveller can say “remind me” to opt in, “remind me tomorrow” to request a 24-hour exception, or “stop reminders” to opt out. A separate satisfaction question is queued 30 minutes after a booking enters the verified `confirmed` state; the worker rechecks that state before sending. Inbound activity cancels or defers pending follow-ups. The worker retries delivery failures. Scheduled delivery currently supports OpenWA. Meta and Twilio need approved outbound template support before timed reminders can be enabled there. All channels can offer to resume an unfinished request when the traveller returns.

Configuration:

- `FEATURE_CONCIERGE_ENABLED=true` enables opening and return hints; it is enabled by default outside tests.
- `FEATURE_WEATHER_CONTEXT_ENABLED=false` enables weather enrichment when set to `true`.
- `FEATURE_PROACTIVE_MESSAGING_ENABLED=false` enables the reminder worker when set to `true`, subject to traveller preference and OpenWA selection.

The two-bubble separator is transport-only and is removed from stored conversation text.

Local acceptance: restart YANA after changing flags or building `dist`. From an authorized test number, share a genuine celebration or difficult event along with a travel request and check that the first message responds to the personal detail before the existing form or search step. In an existing conversation, share a new personal event and check for one acknowledgment; an ordinary `next` request should not get another one. To test follow-ups, enable proactive messaging, complete the travel profile, say `remind me`, leave a request unfinished, and wait at least 30 minutes without messaging. An inbound message defers the follow-up. A satisfaction question is sent only for a real booking row in `confirmed` state, not for a search result or unverified service request.
