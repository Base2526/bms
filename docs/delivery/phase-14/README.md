# Phase 14 — third-party dependency license verification

Status: **CURRENT LOCKFILE VERIFIED; LEGAL/PRODUCTION NO-GO**.

Phase 14 binds license review to the committed `package-lock.json` checksum and fails closed when the
lock changes. Every external package needs license metadata and an exact allowlisted expression;
denied license-family tokens are checked first.

## Current policy

- allowed: MIT, Apache-2.0, ISC, BSD-2-Clause and BSD-3-Clause;
- denied tokens include AGPL, GPL, SSPL, BUSL, non-commercial Creative Commons and UNLICENSED;
- only local Fleet Delivery workspace entries may omit package-lock license metadata;
- `npm run license:verify` reports aggregate counts without copying dependency source or license text;
- Fleet Delivery CI runs the verifier before build and database tests.

This is an engineering compliance control, not legal advice. It does not generate statutory notices,
evaluate patents/trademarks, inspect transitive source headers or approve redistribution. A lockfile
change requires renewed review and policy/checksum update.

The separate driver-mobile verifier binds `apps/fleet-delivery-driver/package-lock.json`, evaluates
881 external packages, two linked workspace packages and the reviewed local `braces@3.0.4-bms.1`
fork. It denies prohibited license-family tokens, hash-binds the fork's preserved MIT license and
the installed MIT text for legacy `exit@0.1.2`, whose lock metadata omits a singular `license` field.
CocoaPods/Gem distribution obligations still require Legal review before release.

**NO-GO.** A passing allowlist check does not resolve Phase 9/10 gates or authorize production.
