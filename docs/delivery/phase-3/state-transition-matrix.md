# Phase 3 dispatch transition matrix

| Source | Trigger | Target | Actor / authority | Preconditions | Evidence and recovery |
| --- | --- | --- | --- | --- | --- |
| `READY_FOR_DISPATCH` | `start_dispatch` | `SEARCHING_DRIVER` | mapped service / `dispatch.manage` | expected Delivery version; active branch policy | attempt, transition, audit and outbox commit together; same idempotency body replays |
| `SEARCHING_DRIVER` | worker creates offer | `OFFERED` | leased worker | eligible ranked driver inside current radius | frozen policy/fairness/location evidence; pending offer unique per attempt |
| `OFFERED` | driver rejects | `SEARCHING_DRIVER` | exact offered driver | pending/current offer version | rejection, transition, audit and outbox; attempt becomes due |
| `OFFERED` | TTL expires | `SEARCHING_DRIVER` | leased worker or late decision path | pending offer past TTL | expiry is durable; retry/radius expansion continues |
| `OFFERED` | driver accepts | `ASSIGNED` | exact offered driver | pending TTL/version; current eligibility and ONLINE state | one assignment enforced by row locks and unique indexes; duplicate returns winner |
| `SEARCHING_DRIVER` or `OFFERED` | deadline/no eligible at maximum radius | `MANUAL_DISPATCH_REQUIRED` | leased worker | search timeout or bounded expansion exhausted | one durable manual queue row, transition, audit and outbox |

No Phase 3 transition moves BMS stock, asserts merchant handoff, sends a notification or creates a
driver financial event. Post-assignment pickup/delivery/return states belong to later phases.
