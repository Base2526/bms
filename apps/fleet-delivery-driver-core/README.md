# Fleet Delivery driver client core

This package is the platform-neutral, synthetic-only Phase 4 foundation. It is deliberately not a
shipping React Native application.

Implemented here:

- a bounded, authenticated offer feed client;
- a server-authoritative current-assignment read for restart recovery;
- a coherent polling/reconnect snapshot for availability, assignment and bounded offers;
- server-authoritative offer decisions;
- durable-command interfaces for availability and offer decisions;
- stable idempotency keys across offline retries;
- conservative availability coalescing only for consecutive commands in the same scope;
- replay-safe synthetic `start_pickup` / `arrive_pickup` commands with server-owned ordering; and
- fail-closed capability flags for real authentication, GPS, KYC, POD, push and contact features.

The persistence adapter and access-token provider are injected. Access tokens are never written by
this package, and queued commands contain no customer details, coordinates, photos or financial
data. A mobile shell must use OS-backed secure credential storage and an approved queue store.

Do not enable the blocked capabilities until the owner approvals and real-device gate listed in
[`docs/delivery/phase-4/README.md`](../../docs/delivery/phase-4/README.md) are complete.
