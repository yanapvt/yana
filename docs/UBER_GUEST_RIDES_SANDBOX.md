# Uber Guest Rides sandbox for YANA logistics

YANA's WhatsApp transport flow currently collects a request and asks an operator
to confirm vehicle and price. It does not book an Uber ride. For tourists who do
not have an Uber account, Uber for Business **Guest Rides** is the relevant API:
YANA can arrange a ride on behalf of a guest while keeping the booking workflow
within YANA. This requires an approved Uber for Business integration and an
organization UUID. Availability in Sri Lanka and commercial terms must be
confirmed with Uber.

## Account setup

1. Request Uber for Business Guest Rides API access in the [Uber developer
   portal](https://developer.uber.com/) or through your Uber Business contact.
   Ask for the `guests.trips` scope, the organization UUID, and **sandbox
   whitelisting**. If Uber routes the application to its 3P Demand team, use
   `hailables-3p-demand-group@uber.com` as listed in its documentation.
2. Put the issued client ID, client secret, and organization UUID in your local
   `.env` as `UBER_GUEST_CLIENT_ID`, `UBER_GUEST_CLIENT_SECRET`, and
   `UBER_GUEST_ORGANIZATION_UUID`. Never commit them.
3. Run `npm.cmd run transport:uber:sandbox`.

The command obtains a client-credentials token with `guests.trips`, creates an
ephemeral sandbox run with Uber's recommended San Francisco test coordinates,
then requests product estimates against that run. It sends **no trip creation
request** and cannot contact the production rides host. The run expires after
8 hours. A successful command proves authentication and basic sandbox access,
not that a real Sri Lanka ride is available or bookable.

If the command reports HTTP 401/403, ask Uber to activate the scope, associate
the organization UUID, and whitelist sandbox access. Keep raw credentials and
provider responses out of tickets and chat messages.

## Before a customer demo or live booking

- Confirm Uber permits YANA's travel-concierge use case, market, payment model,
  and commission arrangement.
- Add geocoded pickup/dropoff, guest name and phone consent, estimate freshness,
  explicit customer confirmation, trip creation, status/webhooks, cancellation,
  and error handling. Use sandbox trip creation and driver-state simulation first.
- Keep sandbox rides out of customer-facing WhatsApp results. The current
  transport form's "Uber" preference is a request for sourcing, not a live Uber
  quote or reservation.

Official references: [Guest Rides overview](https://developer.uber.com/docs/guest-rides/introduction),
[authentication](https://developer.uber.com/docs/guest-rides/guides/authentication),
[sandbox](https://developer.uber.com/docs/guest-rides/guides/sandbox),
[3P Demand integration](https://developer.uber.com/docs/third-party-rides-demand-v1/introduction).
