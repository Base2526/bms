# Fleet Delivery Customer core

Passenger sandbox addition: `src/rideSandbox.ts` supplies the separate authenticated passenger
transport with durable pending-command replay. `native/RideSandboxScreen.tsx` is a shared Debug-only
React Native surface imported by both Customer and Driver (not exported by the platform-neutral
package entry). Each host app supplies its own React/RN/native module resolution. See
[the passenger guide](../../docs/delivery/passenger-sandbox.md) for signup and pay-after-arrival;
none of the original goods-delivery grant permissions below are widened.

`native/RideMap.tsx` adds opt-in Google Maps, bounded Google Routes motorcycle-polyline rendering
and foreground Simulator/Emulator location. Location updates are ephemeral, never durable commands.
See [maps setup and limits](../../docs/delivery/passenger-maps.md).

This package is the platform-neutral Customer App state/API foundation used by the Android/iOS debug
shell in `apps/fleet-delivery-customer`. It supports local synthetic quote, Delivery creation and a
privacy-minimal current-status projection; it is not production authorized.

The client accepts a protected activation payload containing an API origin, short-lived opaque token
and expiry. It sends only a service requirement when quoting and only the accepted `quoteId` when
creating a Delivery. Tenant, branch, BMS order and order version are resolved and rechecked by the
server-side customer grant. Remote cleartext HTTP, expired sessions, unknown response fields and
confirmation without a quote fail closed.

Delivery creation defaults to a quote-bound idempotency key, preserved across a lost reply or client
restart. API origins are normalized so a trailing slash cannot create a `//v1` path. All requests
have a 15-second deadline; a timeout does not claim success and a Delivery retry retains the same key.

Run the synthetic local API flow from the repository root:

```bash
npm run dev:bootstrap
npm run dev:scenario -- customer-search
npm run dev:customer-flow -- <scenario-id>
npm run dev:customer-dispatch -- <scenario-id>
npm run dev:cleanup -- <scenario-id>
```

The scenario and raw token live only in the ignored `.local/fleet-delivery/` mode-`0600` manifest.
Do not copy it into source, logs, screenshots or a production build.

Still required for a complete Customer App: production navigation/identity, checkout/BMS customer
identity integration, real payment, approved location tracking, notifications, contact, POD/dispute views,
signed iOS distribution,
accessibility/representative-device certification, and approved production customer authorization.
