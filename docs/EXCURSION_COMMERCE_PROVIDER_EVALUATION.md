# Excursion commerce provider evaluation

Checked 2026-10-18. This is a sourcing and flow assessment, not evidence of a live supplier connection or a confirmed booking. Public listings establish only that a product appears on a consumer or operator site; partner API inventory, rates, and bookability require partner credentials.

## Required YANA journey

1. Traveler discovers and selects an experience in WhatsApp. Show only live-bookable products as bookable; label Google Places results as discovery.
2. YANA asks for date, party size, and required booking details in chat or a short YANA form. Persist a correlation ID tied to the WhatsApp conversation.
3. Recheck supplier availability, inclusions, total price, cancellation terms, currency, and expiry. Display the final YANA price and ask for explicit confirmation.
4. Open a YANA-controlled payment page only if secure payment cannot occur in WhatsApp. The page must return to YANA and the same WhatsApp thread. Never collect card details in chat.
5. Treat a signed server-side payment callback as payment evidence. Treat a supplier booking confirmation/status as booking evidence. Do not call a payment alone a confirmed excursion.
6. Send the confirmed booking reference, voucher, pickup instructions, and support route into WhatsApp. If payment succeeds but booking fails, reconcile/refund and send a clear status update.

Native WhatsApp payments should not be assumed available for a Sri Lankan YANA business. WhatsApp's help lists India, Brazil, Mexico, and Indonesia as participating countries for paying registered businesses: https://faq.whatsapp.com/1293279751500598/ . A brief YANA checkout page followed by server-verified status and a WhatsApp message is the practical target.

## Current repository facts

- `ExcursionSearchFlowService` calls Google Places discovery and presents three results per batch. It has no supplier inventory or booking call.
- The `excursion_booking` form saves a provider-pending booking request. Its completion message cannot prove availability, payment, or booking.
- `excursion-engine/types.ts` defines a supplier-neutral search and quote interface but no hold, book, status, cancel, or voucher operations. No excursion adapter uses it in the live flow.
- `PayHerePaymentService` can prepare a checkout and verify callbacks; it is not wired to excursion orders, supplier booking, or WhatsApp confirmation.
- Provider flags in `excursionSuppliers.ts` are disabled by default. On this workstation, no Rezdy, GlobalTix, Viator, Klook, or GetYourGuide partner key, and no PayHere merchant ID, was found in process variables or `.env` (presence check only; no values read).

## Provider decision

| Provider | YANA-controlled booking path | Commercial and payment caveat | Current verdict |
| --- | --- | --- | --- |
| GlobalTix | B2B reseller API and portal; advertises live inventory, instant confirmation, commission model, and no consumer-facing storefront. | Need written API, Sri Lanka inventory, merchant/settlement, price display, sandbox, voucher, cancel/refund, and webhook terms. | First partner discussion for the YANA-owned customer journey. |
| Rezdy Agent API | Product, availability, quote, booking, cancellation, and staging API are documented. Negotiated rates can allow direct supplier terms. | Marketplace products use automated payment; docs describe both Stripe card token processing and Payoneer payouts. Confirm current API payment flow and Sri Lankan entity/bank eligibility. Products must be shared and `isApiBookingSupported` must be true. | First technical sandbox candidate, subject to payment and supply gates. |
| Viator Full + Booking | Approved partners can use payment iframe or API and book on a YANA site, then message the result in WhatsApp. | Approval/certification required. Viator remains merchant of record and controls transaction terms; this may not satisfy YANA as merchant. Basic API redirects to Viator and fails the required journey. | Good coverage fallback only with Full + Booking and accepted commercial terms. |
| Klook advanced integration | Advertises API and white-label partner options. | Public material does not establish YANA's booking rights, control of checkout, economics, sandbox, or Sri Lanka API catalogue. Affiliate links fail the required journey. | Request technical and commercial terms; do not build from affiliate assumptions. |
| GetYourGuide Partner API | Public API has search, availability, and booking endpoints. | Access is granted by partner agreement; GetYourGuide's terms say it handles customer payment and supplier/customer communications. | Conditional fallback, depending on terms and access. |
| Tiqets Booking API | Can transact on a partner site. | Booking API is restricted and the published assessment includes 200 monthly orders. More focused on attraction tickets. | Lower priority for first launch. |

Sources: GlobalTix reseller and API pages (https://globaltix.com/resellers/ , https://agent-api.globaltix.com/); Rezdy Agent API and marketplace payment guides (https://developers.rezdy.com/rezdyapi/index-agent.html , https://support.rezdy.com/hc/en-us/articles/19867737922204-How-To-Set-Up-Automated-Payments-as-an-Agent); Viator access levels (https://partnerresources.viator.com/travel-commerce/levels-of-access/); Klook affiliate program (https://affiliate.klook.com/home); GetYourGuide API and terms (https://code.getyourguide.com/partner-api-spec/ , https://www.getyourguide.com/c/partner-terms-and-conditions/); Tiqets access criteria (https://partners.tiqets.com/en_us/do-you-offer-api-solutions-H1pJDp3zi).

## Indicative Sri Lanka inventory sample

These are public listings only; none proves that YANA can access a matching SKU in a reseller API or book it on a chosen date.

| Experience | Public evidence | Partner API status |
| --- | --- | --- |
| Yala safari | Viator listing: https://www.viator.com/tours/Yala-National-Park/Leopard-Safari-Tour-in-Yala-National-Park/d24382-101090P3 ; Klook listing: https://www.klook.com/en-US/activity/211897-yala-national-park-private-safari/ ; Rezdy-hosted operator listing: https://lakpura.rezdy.com/342022/camping-in-yala-national-park-1-night-standard | Unknown for all three; Rezdy operator listing is on-request and does not establish marketplace sharing. |
| Sigiriya guided visit | Viator attraction/tours: https://www.viator.com/Sigiriya-attractions/Sigiriya-Rock-Fortress/d25903-a21768 | Unknown. |
| Mirissa whale watching | Klook listing: https://www.klook.com/en-GB/activity/15323-whale-dolphin-watching-mirissa/ | Unknown. |

Before selecting a supplier, query the partner catalog for at least Yala safari, Sigiriya/Dambulla, Mirissa whale watching, Ella hiking/zipline, Galle cultural walk, and Colombo experiences. For each, record the exact supplier SKU, dates, availability, inclusions, final price, YANA margin, API bookability, cancellation, confirmation time, and voucher format. Compare like-for-like products only; park-entry and transfer inclusions vary materially.

## Partner gates and next execution

1. **GlobalTix:** obtain a reseller API/sandbox account and written answers on whether YANA can collect the traveler payment with PayHere, settle with GlobalTix, own the customer relationship, receive booking/voucher events, and sell the required Sri Lankan SKUs. Ask about fees, minimums, net rates, refunds, and SLA.
2. **Rezdy:** create agent staging and production accounts; obtain YANA's own keys. Verify actual Sri Lankan marketplace SKUs. Ask Rezdy to reconcile its current Payoneer payout help with its Stripe-token Agent API booking instructions, and confirm Sri Lankan onboarding and whether a negotiated `FULL_AGENT` rate can use YANA PayHere checkout. Public demo keys are read-only and cannot test a booking.
3. **Viator:** request Full + Booking access and confirm customer ownership, booking/status callbacks, currencies, and permission to return the traveler to YANA WhatsApp after checkout. Do not substitute Basic referral links.
4. **Payment:** obtain PayHere sandbox merchant credentials; integrate payment/order binding, callback, and return page before real supplier booking. A browser `return_url` is not payment proof; PayHere says to update status from the server `notify_url`: https://support.payhere.lk/api-%26-mobile-sdk/checkout-api.I .
5. **Build after access:** add provider adapters, live-match and quote checks, a durable order state machine with idempotency, payment/supplier reconciliation, and WhatsApp re-entry/status messaging. Keep provider-specific shapes inside adapters and leave providers disabled until credentials and terms pass validation.

Decision now: **GlobalTix is the best commercial-fit prospect; Rezdy is the most testable documented API; neither is yet validated for YANA transactions.**
