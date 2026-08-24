# LiteAPI local search smoke test

This test validates authentication, the real rates endpoint, response parsing,
supplier orchestration, timeout/retry behavior, and normalized output. It does
not prebook, book, cancel, charge a card, or route unverified supplier data into
WhatsApp.

Official references:

- Authentication: https://docs.liteapi.travel/reference/authentication
- Hotel rates: https://docs.liteapi.travel/reference/post_hotels-rates
- Prebook: https://docs.liteapi.travel/reference/post_rates-prebook

## Prerequisites

1. Docker Desktop is running.
2. `docker compose ps` shows `yana-postgres` and `yana-redis` healthy.
3. Obtain a sandbox or live API key from the Nuitee Connect/LiteAPI dashboard.
4. Never paste the key into chat, source code, `.env.example`, logs, or command
   arguments.

## Configure `.env`

The placeholders are already present in the ignored local `.env`. Set:

```env
HOTEL_SUPPLIER_ORCHESTRATION_ENABLED=true
LITEAPI_ENABLED=true
LITEAPI_BASE_URL=https://api.liteapi.travel/v3.0
LITEAPI_API_KEY=your-key-here
```

Keep all other inventory providers disabled for the first test.

## Run

With automatic future dates:

```powershell
npm.cmd run hotel:liteapi:smoke
```

With explicit destination and dates:

```powershell
npm.cmd run hotel:liteapi:smoke -- "Bentota, Sri Lanka" 2026-09-20 2026-09-23
```

Expected sanitized output includes:

```json
{
  "supplier": "liteapi",
  "status": "success",
  "hotelCount": 1,
  "rateCount": 1,
  "sampleHotels": [],
  "sampleRates": []
}
```

Counts may be zero when the supplier has no availability for the chosen search.
The command never prints the API key or raw supplier response.

## Interpreting price basis

The smoke output labels returned pricing as `NET` or `RETAIL`:

- `NET`: may be eligible for acquisition-cost pricing only after the account's
  markup/display rights are confirmed and configured.
- `RETAIL`: may be displayed according to supplier terms, but the YANA pricing
  engine will not treat it as net cost or automatically add margin.

Do not enable customer booking based on a successful search alone. Prebook must
recheck the selected `offerId`, final amount, room, meal plan, and cancellation
terms before confirmation.

## Common failures

- `401 unauthorized`: key is missing, invalid, or belongs to the wrong environment.
- `429`: rate limit; wait for cooldown and reduce request frequency.
- Timeout: increase `LITEAPI_TIMEOUT_MS` only after checking supplier latency.
- Zero rates: use future dates, another destination, or an explicit known hotel ID.
- Retail-only rates: confirm commercial/net-rate access with LiteAPI before
  enabling YANA margin calculations.

## Disable after testing

```env
HOTEL_SUPPLIER_ORCHESTRATION_ENABLED=false
LITEAPI_ENABLED=false
```
