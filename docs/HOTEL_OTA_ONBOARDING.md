# Hotel OTA onboarding for YANA

Status (2026-10-18): no Booking.com Managed Affiliate or Agoda Demand partner IDs or API credentials exist yet. The Agoda Developer Portal contact form was completed with YANA's business details, but its submission endpoint returned "Your form details couldn't be submitted". This is **not** a submitted application. Agoda's onboarding guidance says a new API account is created after commercial procedures and directs applicants to an account manager. Do not enable these providers until contracts, credentials, and integration tests are complete.

Until an OTA covers a selected hotel, a traveler can consent to a YANA sourcing request in WhatsApp. The request is saved without an external hotel link or unverified price. An operator can review these leads locally with `npm.cmd run hotel:sourcing:queue`; this is a review queue, not an automatic supplier booking or staff notification.

## Booking.com Demand

- Apply for **Managed Affiliate Partner** access to the Demand API and request a **Search, look and book** integration so the traveler can complete the booking inside YANA. The public Booking.com affiliate registration currently points to CJ's link/redirect program; that is not equivalent to Demand API access.
- The legacy Demand API signup page links to a retired support host. The current route requires a Managed Affiliate relationship and Booking.com Account Manager; use an existing Partner Centre account if YANA has one, or seek an introduction to the Managed Affiliate team. Do not register through CJ expecting Demand API credentials.
- Ask the account manager for Partner Centre access, sandbox, API token, Affiliate ID, permitted display/booking flow, accommodation content, rate and order APIs, and commercial terms.
- Ask specifically whether YANA can receive net rates or approved discounts and set its own final selling price. Booking.com's TPI net rates require a Net Rates Partner Addendum, a dedicated Affiliate ID, and additional payment and service capabilities.
- Do not represent public Booking.com website prices as API rates. Compare only authorized, current, equivalent final customer totals.

Official starting points: [Demand prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites), [application flows](https://developers.booking.com/demand/docs/development-guide/application-flows/application-flows-overview), [net rates](https://developers.booking.com/demand/docs/accommodations/tpi/net-how-to).

## Agoda Demand

- Send a partner enquiry through the [Agoda Developer Portal contact form](https://partners.agoda.com/DeveloperPortal/APIDoc/ContactUs). Request Search, Pre-check and Book API access and sandbox credentials.
- Confirm whether **Agoda Fulfill Assisted** or **Partner Fulfillment** supports YANA's desired in-chat customer experience, who charges the guest, who issues vouchers, and who handles changes and cancellations.
- Ask for commission/net pricing and display permissions, price-comparison terms, test credentials, certification steps, and live access criteria.
- Agoda's documented legacy API-key authentication is scheduled for deprecation by the end of 2026. Ask for its recommended OAuth/token-based path.

Official starting points: [Getting started](https://developer.agoda.com/demand/docs/getting-started), [sandbox setup](https://developer.agoda.com/demand/docs/environment-setup), [authentication](https://developer.agoda.com/demand/docs/authentication).

## YANA pricing rule

YANA can show a "lower than Booking.com/Agoda/direct" claim only when it has an authorized, fresh, like-for-like reference quote for the same property, dates, occupancy, room, meal plan, cancellation and payment terms, currency, taxes, and mandatory fees. Its final customer price must also cover supplier acquisition cost, unavoidable charges, and the required YANA margin. If these conditions do not hold, show YANA's own checked quote without an undercut claim.

## Application details needed

YANA has supplied its legal name, website, contact name, and business email for partner outreach. No existing partner ID is needed to describe a **new** partnership application. Still needed when requested by a partner: registered country, expected monthly hotel bookings or traffic, and customer service/fulfillment model. Do not invent these details or put personal contact details or credentials in the repository.

Agoda's [new API account guidance](https://traveldistribution.support.agoda.com/kb/s/article/How-can-I-apply-for-a-new-Agoda-API-account) says the API account follows commercial onboarding. Booking.com's [Demand prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites) require Managed Affiliate status and Partner Centre access before issuing the API key and Affiliate ID.
