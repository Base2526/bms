# BMS full-feature recheck — 17 November 2026

This is a **local repository and disposable-test-database review**, not a production release
certificate. The 36 work packages and their acceptance criteria are in
[feature-completion-plan.md](../feature-completion-plan.md). No target tenant, deployed artifact,
provider contract, signed native build or human professional approval is represented here.

## Source and evidence identity

- Source baseline: `develop` commit `ddfd8483679d77b4243031c7c41927f7f0de8bf0` plus the changes in
  this review branch. The initial full DB run used the dirty original workspace; the worktree
  contains separate documentation/PDF/test changes. **Do not treat either as an exact clean
  release-commit result.**
- Test Postgres: isolated `bms-realtime-test` Docker Compose instance on `127.0.0.1:5433`.
  `bms_realtime_test` is a restored BMS schema; the named freemium, requisition and operations
  databases are disposable tests on the same instance. Restaurant pickup uses a temporary
  localhost port `5547` relay to its dedicated synthetic database. No DB suite targeted port
  `5432` or a production database.
- Registry: `88` **known code capabilities**; `2` without direct workflow test links;
  `scope=baseline-in-progress`. The missing IDs are `settings.marketplaces` and
  `shipping.carrier-integrations`. A linked test is a map, not a passing result.

## Checks actually run

| Check | Result | What it proves and does not prove |
| --- | --- | --- |
| Release registry check | Pass; 88 known, 2 unmapped | Source/test paths and baseline debt; not a complete inventory or tenant rollout |
| Web regression inventory and TypeScript | Pass | Registered files and types in the review worktree |
| Web pure suite, final full run | 383 files; 3,825 pass, 0 fail, 10 skip | DB-free boundary contracts in the review worktree, including report-email and Thai-PDF contracts |
| Web production build | Final full `npm run gate` pass; 151 static pages | Review-worktree build, not yet an exact clean-commit release gate |
| Original-workspace DB suite | 110 files; 923 pass, 8 fail, 20 skip | All 8 failures were dedicated-database guards on `bms_realtime_test`, not failed business assertions |
| Eight guarded DB files on their required test databases | 93 pass, 0 fail | Freemium 30, requisition 24, operations 32, restaurant pickup 7; still not target deployment evidence |
| Restored-schema readiness + pickup mail template readiness | Pass | Required schema objects and eight published Thai/English pickup templates exist on the test clone only |
| Mobile TypeScript + Jest | Pass; 61 suites, 478 tests | Source-level native behavior, not signed/device/hardware proof |
| Desktop Node suite | Pass; 153 tests | Source-level shell behavior, not installed-package/hardware proof |
| General report PDF targeted contract | 2 pass; four-page sample visually inspected | Sarabun renders Thai, row 201 is present, >10,000 rows reject; pypdf/PyMuPDF extract Thai text in NFKD-equivalent form |

The first `npm run gate` completed its registry, inventory, typecheck and pure steps; its build
could not write `.next` because the host ran out of disk space. After deleting only generated
worktree files, the full gate passed on retry.
Afterward Docker Desktop became unavailable, so the retail-cart/branch-price/shipment DB rerun
from the review worktree received `ECONNREFUSED`. Those attempts are **not failures of the business
contracts** and are **not passing worktree DB evidence**. Rerun them and the full DB suite after
Docker recovers, on the exact clean commit selected for release.

## Findings by priority

- **P0:** Schema and transaction contracts run on the restored local database, including money,
  stock, tenant/RBAC and rollback paths. The inventory is still a baseline; a clean-commit
  manifest, backup restore to another instance, target flag/migration snapshot, authenticated
  browser, realtime recovery and load targets remain open. Tax-point changes await an accountant.
- **P1:** Retail cart, scheduled branch pricing and transfer-lot code exist, but no end-to-end
  target tenant pilot is recorded. Retail-specific Click & Collect is a separate unfinished
  fulfillment contract. Advanced coupons and multi-step follow-up need product-policy scope.
- **P2:** Desktop station printing and pickup queue are pilots. Order-status email is still
  fire-and-forget; report-email boundary checks do not provide a durable outbox. Named printer,
  drawer, display and provider mailbox checks remain open.
- **P3:** No official sandbox/contract credentials are available for TikTok outbound,
  Shopee/Lazada, Flash/Kerry, foodpanda, GrabFood or LINE MAN. Keep their existing beta, shadow,
  mock or contract-blocked labels and gates. Recurring plan billing needs a finance/product
  decision before implementation.
- **P4:** Bank reconciliation remains an evidence-only flag-off sidecar; e-Tax has no verified
  signing/submission provider; pharmacy remains flag-off until a licensed pharmacist approves.
  General PDF report output now embeds OFL Sarabun and no longer truncates silently at 200 rows.
  VAT and stock-ledger PDFs remain blocked because their statutory table layout is incomplete.
- **P5–P6:** Mobile, Desktop and Retail Local have source tests but lack exact installed/signed
  hardware and clean-machine qualification. Operations, fish-dock, board-game analytics and AI
  delivery need named tenant/operator pilots. Insurance and Q4 simulation require product/legal
  decisions. Public help remains a mockup; public live figures need authorized data sources.

The Mobile lockfile also resolves `image-size@1.2.1` through `metro@0.87.0`.
`npm audit --omit=dev` reports one high-severity denial-of-service advisory for crafted JXL/HEIF
or ICNS buffers; the [JXL/HEIF advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
and [ICNS advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) list `2.0.3` as patched.
This is a **dependency-review item**, not proof of exposure in the installed mobile app: Metro is
the bundler, and forcing its `^1.0.2` dependency to a new major version needs compatibility and
native-build verification before changing the lockfile.

## Release decision

**Not approved for blanket production enablement.** Keep pharmacy, bank reconciliation and
contract-blocked external integrations gated off. A production release needs the exact clean
commit, build artifact digest, target preflight, applied migrations, effective tenant flags,
permissions, backup/rollback proof and the independent provider/hardware/professional sign-offs
listed in the completion plan. Source code, local test results and a migration filename do not
replace those records.
