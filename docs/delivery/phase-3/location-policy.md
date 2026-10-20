# Phase 3 driver location policy

Location input uses WGS84 longitude/latitude validated at the API boundary, a positive monotonic
sequence, device timestamp, server receive timestamp, accuracy metres and an explicit mock-location
signal. A driver may submit only while `ONLINE` or `BUSY` and must remain active, verified and in the
requested tenant/branch membership.

The server stores accepted and rejected observations as append-only evidence. It rejects:

| Reason | Rule |
| --- | --- |
| `OUT_OF_ORDER` | sequence is not greater than the latest accepted sequence |
| `STALE` | device time is more than 120 seconds behind server receive time |
| `FUTURE_TIME` | device time is more than 30 seconds ahead |
| `INACCURATE` | reported accuracy exceeds 200 metres |
| `MOCK_SIGNAL` | device reports a mock location |
| `IMPOSSIBLE_TRAVEL` | movement from the prior accepted point exceeds 60 metres/second |

Dispatch applies the stricter configured policy freshness and maximum accuracy to the latest accepted
row. Rejected evidence never becomes a matching location. Reusing an existing `(driver, sequence)`
with a different request is a conflict; replaying the same idempotency key/body returns its saved
result.

These are synthetic backend controls, not a claim that mobile GPS is trustworthy. Phase 4 must add
device/session authority, foreground/background behavior, offline queue ordering, permission loss,
battery handling, privacy windows and an approved retention/deletion schedule before real collection.
