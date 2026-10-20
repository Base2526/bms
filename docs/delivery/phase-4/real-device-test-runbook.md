# Fleet Delivery real-device test runbook

Status: **READY FOR FAIL-CLOSED BASELINE / FEATURE CERTIFICATION BLOCKED**

This runbook separates tests that are safe with the current synthetic build from GPS, notification
and device-trust certification that needs approved policy and an implementation. Passing the baseline
must never be reported as passing GPS, push notification or production device certification.

## 1. Evidence rules

- Use a non-production environment, synthetic driver, synthetic tenant/branch and redacted places.
- Never capture or persist a UDID, Android serial, phone number, coordinate, push token, access token
  or screen containing a credential. Record only an approved asset reference, device model, OS
  version, build commit, app version, date, tester role and outcome.
- Run `npm run device:inventory` before touching a device. It intentionally drops device names and
  identifiers. `npm run device:inventory -- --require-physical` exits non-zero if no physical device
  is online.
- Run `npm run verify:device-safety` before and after the exercise. Any failure stops the run.
- Do not add location/push permission, entitlement, native package, provider credential or real
  account to make a blocked case runnable.

## 2. Current baseline suite (allowed)

Run each case on every approved target model and OS version.

| Case | Procedure | Expected result |
| --- | --- | --- |
| Install and identity | Install Debug, then inspect the installed package/bundle | Identity is `com.bms.delivery.driver.debug`; it does not replace Release or BMS POS |
| Permission absence | Inspect system app permissions before and after first launch | No Location, Notifications, Camera, Contacts or Phone permission is requested or listed |
| Synthetic activation | Activate with a short-lived synthetic credential against local/non-production HTTPS | Debug can activate; no real driver/customer record is used |
| Network loss | Queue one availability change, disable network, reconnect and sync | UI stays explicit; the original idempotency key is retried and server result remains authority |
| App kill/restart | Queue a command, force-stop/terminate, relaunch, then reconnect | Reference-only queue restores from secure storage; no coordinate, photo or customer data appears |
| Sign-out | Sign out, force-stop, relaunch | Synthetic session and queued references are cleared; activation screen returns |
| Release boundary | Install an unsigned/local Release build in a controlled lab if signing is available | No activation form and no session can be created; do not distribute the artifact |
| Log inspection | Inspect Metro/native logs during every case | No token, device identifier, customer PII, coordinate or push token is logged |

Stop and record `FAIL_CLOSED` if identity differs, an unexpected permission prompt appears, Release
can activate, sensitive data reaches logs, or recovery silently discards a queued command.

## 3. Blocked feature-certification suite

These cases are `BLOCKED_POLICY_AND_IMPLEMENTATION`; they are not skipped passes.

| Area | Required cases | Unblock requirements |
| --- | --- | --- |
| GPS | foreground fix, stale/inaccurate fix, GPS loss, background/terminated behavior, permission withdrawal and re-grant | DPO/Legal purpose, notice, retention/deletion/hold approval; Operations/Safety behavior approval; supported OS matrix; reviewed implementation |
| Notifications | foreground, background, terminated tap/deep-link, denial, token rotation, logout/revocation and provider outage | Security-approved FCM/APNs ownership and credentials, message classification, token lifecycle, support/incident owner and reviewed implementation |
| Device trust | lost/replaced device, remote revocation, rooted/jailbroken device response, OS-keystore unavailable and clock/network manipulation | Security identity/session/device-trust design plus Operations recovery process |
| Safety | distracted-driving behavior, SOS/abuse escalation, pickup failure and support handoff | Safety/Legal/Support runbook, trained owner and escalation test |

When unblocked, update `device-certification-policy.json` in the same reviewed change as the native
permissions and implementation. Add exact target versions and acceptance thresholds; do not weaken
the current allowlists in advance.

## 4. Result vocabulary

- `PASS`: the exact case ran on the named model/OS/build and met every expected result.
- `FAIL_CLOSED`: the case encountered a fault and denied the unsafe action with a visible recovery.
- `FAIL`: unsafe behavior, data exposure, silent loss or unexpected permission/activation occurred.
- `BLOCKED_NO_ONLINE_PHYSICAL_DEVICE`: tooling found no usable physical device.
- `BLOCKED_POLICY_AND_IMPLEMENTATION`: an approval, credential owner or reviewed feature is absent.

The Phase 4 gate remains blocked until all target devices pass the baseline and every required GPS,
notification, device-trust and Safety case is implemented, executed and approved by its named owner.
