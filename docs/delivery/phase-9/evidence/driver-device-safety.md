# Driver device and safety packet

Owners: Operations, Safety and Mobile Engineering. Approve driver identity/KYC boundary, supported
OS/device matrix, foreground/background location behavior, consent and permission withdrawal,
offline behavior, distracted-driving controls, incident escalation and support ownership.

Run the pickup journey on every target device and cover permission withdrawal, GPS loss, app kill,
network loss, stale offer and support escalation. Evidence must contain versioned device/OS results
and a reviewed failure disposition; screenshots must use synthetic accounts and redacted locations.

## Engineering packet available

- `docs/delivery/phase-4/device-certification-policy.json` is the machine-readable fail-closed
  permission, capability, identity and data-handling boundary.
- `docs/delivery/phase-4/real-device-test-runbook.md` separates the allowed physical baseline from
  feature certification that needs approval and implementation.
- `docs/delivery/phase-4/device-test-results-2026-10-18.json` records the first redacted inventory
  and repository-boundary result. It found zero online physical devices, so it is blocker evidence,
  not a device-certification pass.
- `npm run verify:device-safety` prevents location/push permissions, entitlements or runtime packages
  from entering the currently disabled build without a reviewed policy change.

Current result: `BLOCKED`. The repository boundary passes, but no physical case ran. Operations and
Safety still need to approve the target-device and incident behavior. DPO/Legal must approve exact
location policy, and Security must approve push credentials/token lifecycle and device trust before
those feature cases are implemented or exercised.
