import assert from "node:assert/strict";
import test from "node:test";
import {
  dutyKey,
  teamInstant,
  teamWindow,
  TEAM_PERMISSIONS,
} from "../apps/web/lib/bms/operationTeamPolicy.ts";
import { teamHash } from "../apps/web/lib/bms/operationTeamReads.ts";
test("Release D: duty keys normalize and reject unsafe/empty/overlong identifiers", () => {
  assert.equal(dutyKey(" Kitchen-Lead "), "kitchen-lead");
  for (const v of ["", null, "a b", "x".repeat(61), "../x"])
    assert.throws(() => dutyKey(v));
});
test("Release D: half-open overnight duty interval requires offset and at most 24 hours", () => {
  assert.equal(
    teamWindow("2026-10-24T22:00:00+07:00", "2026-10-25T06:00:00+07:00").endsAt,
    "2026-10-24T23:00:00.000Z",
  );
  for (const v of ["2026-10-24T22:00:00", "bad", null])
    assert.throws(() => teamInstant(v));
  assert.throws(() =>
    teamWindow("2026-10-24T00:00:00Z", "2026-10-25T01:00:00Z"),
  );
  assert.throws(() =>
    teamWindow("2026-10-24T00:00:00Z", "2026-10-24T00:00:00Z"),
  );
});
test("Release D: snapshot fingerprints survive JSONB key ordering; array order is material", () => {
  assert.equal(
    teamHash({ a: 1, b: { x: 2, y: 3 } }),
    teamHash({ b: { y: 3, x: 2 }, a: 1 }),
  );
  assert.notEqual(teamHash([1, 2]), teamHash([2, 1]));
});
test("Release D: acceptance, management and confirmation have separate permissions", () => {
  assert.equal(TEAM_PERMISSIONS.CONFIRM_DAY, "operations.summary.review");
  assert.equal(TEAM_PERMISSIONS.TRANSFER_ITEM, "operations.handover.manage");
  assert.equal(
    TEAM_PERMISSIONS.RECEIVE_HANDOVER,
    "operations.handover.receive",
  );
  assert.equal(TEAM_PERMISSIONS.PUBLISH_ROSTER, "operations.roster.manage");
});
