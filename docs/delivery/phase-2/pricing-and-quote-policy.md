# Phase 2 pricing and quote policy

## Inputs and authority

- Tenant/branch scope comes from an active server-side service-principal mapping.
- Item eligibility, order version, payment state, drop-off confidence and route evidence come from a
  validated synthetic BMS order-context event. Phase 2 never accepts an authoritative browser fare.
- The active merchant configuration supplies hours, service polygon, TTL and pricing rule version.
- Route provider is restricted to `synthetic`; no straight-line estimate is presented as a verified
  provider route.

## Eligibility boundary

A quote is refused unless the merchant is enabled and open, the destination is covered by the active
PostGIS polygon, confidence is at least `0.8`, payment is `UNPAID`, expected order version matches,
all items are `ELIGIBLE`, and both eligibility and route observations are at most 15 minutes old.
Unknown/unsupported/stale eligibility rejects the whole delivery; no line is silently removed.

## Exact calculation

All amounts are non-negative safe integer satang and currency is `THB`.

```text
started_kilometres = ceil(route_distance_metres / 1000)
distance_charge = started_kilometres * per_started_km
gross_delivery_fee = max(minimum_fare, base_fare + distance_charge)
merchant_subsidy = min(configured_fixed_subsidy, gross_delivery_fee)
explicit_discount = 0 in Phase 2
customer_contribution = gross_delivery_fee - merchant_subsidy
commission = round_half_up(gross_delivery_fee * commission_bps / 10000)
```

Therefore `customer contribution + merchant subsidy + explicit discount = gross delivery fee`.
Commission is only a quote snapshot; Phase 2 does not recognize revenue, tax, cash or a payable.

## Expiry and binding

TTL is versioned per merchant configuration and limited to 60–1,800 seconds. Delivery creation locks
the quote and requires it to remain `ISSUED`, unexpired, and linked to the current order/eligibility
versions. Binding is one-way and its economics are immutable. A stale/expired quote requires a new
quote; no fallback price or silent increase is allowed.
