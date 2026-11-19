# Construction-materials release evidence — 2026-11-19

Status: **PILOT / INCOMPLETE**. This file records implementation and observed checks on the
local isolated environment. It is not a production deployment or a tax/hardware certification.
No customer messages were sent.
`AGENTS.md` references `RTK.md`, which was not present in this checkout; the available
repository instructions and domain invariants were followed.

## Scope and authority

The intended flow is catalog → quotation → approved order → stock → payment/AR → shipment →
return → tax/reporting. Orders, line amounts, stock movements, AR ledger, quote revisions and
published facts are server/database authority. AI has only approved catalog tools. The default
quote does not reserve stock; conversion rechecks availability. Catalog prices and the new
weighed rate are VAT-inclusive. An unknown freight amount blocks quote approval.

| Area | Implemented in this working tree | Remaining gate |
| --- | --- | --- |
| A. Catalog, units, stock | Existing integer base-unit inventory/Product Packs, serial/lot/VAT/branch services; sourced, variant-specific specs with separate publication (`10.135`). | No complete four-unit contract (stock/sell/price/display) across import, PO, every channel and return. Paint 1 L vs 5 L must remain distinct physical variants/SKUs unless the supplier documents an actual pack. |
| B. Weighed/cut | Prefix-22 gram labels use exact integer satang per kilogram (`10.136`), per-label rounding, server recheck and frozen `line_amount`/return allocation. Published retail rate blocks subsequent online surface or scale-mapping changes. | No per-metre price, roll/lot cut job, kept remnant/waste/COGS ledger, non-sellable cut return decision, or physical scale/refund validation. |
| C. Quotations | Invalid/unavailable lines fail the whole transient quote. Durable quote draft/revision/approval/acceptance/conversion (`10.133`–`10.134`) uses frozen approved prices, idempotency, audit and existing order service. | Needs real contractor/branch policy, authenticated UI, actual tax layout/accountant review and deployment migration verification. |
| D. POS, credit, VAT | Existing POS PIN/RBAC/approval/idempotency and AR ledger remain authority. Internal AR statement query reads ledger and overdue balances in one SQL snapshot, warns on cache mismatch, and sends nothing. | Full cash/QR/card/split/deposit/credit/return/void matrix with new units; external statement/dunning; VAT-exclusive B2B contract across channels and accountant sign-off. |
| E. Heavy/multi-trip delivery | Quote conversion supports an explicit project site or retail branch pickup through existing order fulfillment. | Order/shipment still use whole-order stock movement. No line-level partial shipments, trip/vehicle/driver/load/POD workflow or partial tax/payment/report impact proof. |
| F. Procurement/AP | Existing PO/partial receipt and stock movement services are the base. Supplier package name, count, integer base-unit factor and source evidence are frozen on each new PO line (`10.137`); partial receipts must supply a matching package count, select an allowed branch and keep the existing stock movement transaction. | Supplier returns, AP ledger, three-way match and inbound freight capitalization remain absent. Expense evidence is not an AP substitute. Supplier pack size must be verified against a real supplier before use. |
| G. AI/chat/web | Customer AI sees published technical facts only; measured-rate public price is suppressed; staff guidance and quote tool fail closed on invalid lines. | No published customer quote/contract-price tool, cut/delivery/PO tools, or end-to-end checkout and slip confirmation cycle for new units. |

## Checks actually observed

| Check | Result | Meaning and limit |
| --- | --- | --- |
| Quotation DB contract on throwaway | 8/8 passed after measured-rate change | Revision/approval/conversion and rollback paths; no production migration proof. |
| Product technical-spec DB contract on throwaway | 6/6 passed | Source/publication/tenant controls; supplier facts still need human review. |
| Weighted kilogram DB contract on throwaway | 6/6 passed after sales-surface and scale-policy guards | Exact satang, rate revision, label/order/return allocation, RLS/audit and concurrent publication. Does not operate a physical scale or complete a POS refund. |
| Supplier unit DB contract on throwaway | 1/1 passed; migration `10.137` applied and rerun without error | Invalid factor/source, frozen PO snapshot, partial receipts, retry, mismatch rollback, stock movement and RLS. Does not establish the supplier's actual pack specification or cover AP. |
| Stock integrity DB regression on throwaway | 17/17 passed after the supplier-unit change | Concurrent receipt retries, lot policy, audit rollback, order stock and tenant isolation remain intact. |
| AR DB contract on throwaway | 26/26 passed after applying missing baseline migrations `10.129` and `10.130` to that throwaway database | Credit sale, mixed payment, collection, return, void, due date, ledger statement and cache drift. The first attempt failed because `bms_order_open_items` was absent in the throwaway schema; this was not a code assertion pass. |
| Mobile Jest | 61 suites, 480/480 tests passed after shared cart-pricing change | No hardware certification. |
| Desktop node tests | 164/164 passed after shared cart-pricing change | No device/printing acceptance. |
| Browser | `/admin/weighted-prices` and `/admin/receivables` reached the login boundary at desktop and mobile widths | Authenticated page content and workflows were not verified; no test credentials were available. |
| Web gate | `cd apps/web && npm run gate` passed on the final frozen code state: 3,866 pure tests, 3,856 passed, 10 skipped, 0 failed; TypeScript and optimized production build passed. Log: `.test-output/building-materials-gate-clean.log`. | Earlier gate runs exposed authored-copy, assistant-guide, pinned-question and dismissible-alert contract failures; each was fixed, narrowly retested, then the whole gate was rerun. Pure/build success is not a DB, hardware or production rollout proof. |

The isolated `bms_realtime_test` database on local port 5433 was used. Migrations `10.133`–`10.137`
were applied and rerun there in earlier slice tests. `10.129`/`10.130` were added to this same
throwaway because the restored baseline lacked the open-item tables required by current POS code.
No production database was touched. No customer notification, provider call or deployment was made.

### Supplier-unit receiving retest

The first Web gate after `10.137` passed registry, inventory and TypeScript checks but stopped
at one pure contract failure (3,857 passed, 1 failed, 10 skipped): the REST receipt adapter
added `supplierQty: null` to a legacy request. It now forwards the field only when supplied;
the narrow `stock-integrity-contract` retest passed 39/39. The authenticated mocked API browser
smoke then found that an unresolved receipt disabled lot inputs but left the base quantity
editable. Both base and supplier quantity fields are now explicitly disabled while the frozen
request awaits retry. The same smoke passed Thai and English at 1440px and 390px after the fix,
including a supplier package creation/partial receipt with 2 × 40 = 80 ordered and one package
received as 40 base units. The browser test uses mocked API responses, so the isolated DB
contract remains the evidence for actual stock writes.

A converted PO with missing cost formerly inherited the legacy zero default. The service and
REST boundary now reject unknown cost for supplier-package lines; a zero cost must be entered
explicitly. The DB contract retest passed 1/1, and the browser smoke confirmed that an empty
cost is not submitted. Converted PO creation and receipt also reject missing stable request
keys so a repeated partial receipt cannot add stock twice; the DB contract passed again after
these guards. Mobile Jest passed 61/61 suites and 480/480 tests before a new package
receipt retry test was added; that targeted test passed 7/7. Final whole-suite, Web gate and
Word render results are recorded below after the last edit.

A subsequent native-caller trace found that the POS GraphQL resolver and POS REST route dropped
`supplierQty` before reaching the service. Both now validate and forward it, the POS GraphQL
input SDL and committed schema expose it, and mobile types were regenerated. The API boundary
regression passed 40/40 `stock-integrity-contract` checks and `mobile-graphql-contract` passed
34/34 after the fix. The supplier DB contract passed 1/1 again; the mobile UI test exercises
the package quantity and frozen retry payload. The earlier Web gate result preceded this adapter
fix, so only a later gate run counts as final.

The Admin PO creator now scopes an unresolved create request to the server-returned acting
tenant and user. A different tenant opens an empty form rather than replaying the previous
shop's payload. If session storage cannot persist the key, no create mutation is sent.
The mocked browser smoke exercised an aborted create, tenant switch and storage-write failure
in both languages at 1440px and 390px. This is client retry safety evidence; the server still
derives tenancy and validates the key/hash in its own transaction.

The supplier receipt audit found the Admin default branch could be used by a staff member
scoped to another branch. The receiving transaction now locks the actor's allowed-location rows
and returns `BRANCH_FORBIDDEN` before stock, movement or retry evidence. The first new DB fixture
failed setup because its fake location inherited the existing `00000` branch code; assigning a
unique fake branch code fixed the fixture. The DB retest passed 1/1 and verified the denial wrote
no stock or movement. At that point Admin lacked a branch selector; the subsequent branch
selection slice and its verification are recorded below.

The updated `.docx` was converted to an eight-page A4 PDF with a temporary fontconfig that
exposes macOS Thai fonts to headless LibreOffice. All eight pages were rendered and visually
inspected: Thai text and tables are readable, with no clipped rows or empty content pages.
The PDF and page PNGs are local ignored review files under `.test-output/docx-review/withfonts/`;
the `.docx` ZIP and XML also parse. This is layout review, not a print-shop proof.

## Operator-manual addendum (2026-11-19)

The Thai [operator guide](../คู่มือร้านวัสดุก่อสร้าง.md), paired `.docx` copy and bilingual
`/admin/manual/building-materials` summary were added. The Admin manual now links to that
summary. The archetype/product examples and Thai/English onboarding copy no longer present
distinct paint containers as a breakable pack or roll cutting as an available sale workflow.

The first Web gate found three documentation-route contract failures: the new page lacked a
navigation parent and assistant-guide coverage, and two alerts were not dismissible. Moving the
page under `/admin/manual` and making the alerts closable resolved them. Narrow retests passed
25/25 `admin-navigation-contract` and 19/19 `work-assistant-knowledge-contract` checks. The
final `npm run gate` passed: 3,866 pure tests, 3,856 pass, 10 skip, 0 fail, plus typecheck and
production build. Markdown relative links had no missing files, the Word ZIP/XML contained the
complete Thai text, and Quick Look displayed its first page, headings and tables in Thai.
The browser reached the expected login boundary for the new route at desktop and 390px mobile
width; no authenticated view or real store workflow was exercised. No DB suite was needed for
this documentation/route change. The release status above remains **PILOT / INCOMPLETE**.

## Public Learning Center guide addendum (2026-11-19)

The public `/learn/building-materials` pilot path now has a home card, desktop/mobile and sidebar
navigation, a 12-node bilingual focused Flow, 25 ordered lessons (nine dedicated articles), a
pilot checklist, search coverage and sitemap entries. The admin manual points to this public guide.
The guide distinguishes implemented workflows from roll cutting, multi-trip delivery, AP and
VAT-exclusive B2B pricing that still need work. Examples are labeled fictional. This is educational
content, not a claim that the construction-materials business workflow is ready for production.

Thai Flow narration was generated from the authored construction cues using the repository's
FastThaiG2P workflow and pinned model checksum. Twelve new MP3 clips are in the manifest and
provenance alongside the 49 preserved business-guide clips; the audio contract verifies each
file, SHA-256 and measured duration. English uses browser speech synthesis. Recorded narration
now pauses and resumes the same clip position; the Flow keeps one active cue and focus in
full-screen mode. A missing recording shows a playback error and leaves the transcript/manual
controls available.

| Check | Observed result | Limit |
| --- | --- | --- |
| `learning-center-contract` | 10/10 passed after the final cue copy/audio regeneration | Covers bilingual path, pilot gaps, cue targets, complete file/manifest/provenance/hash/duration contract; no physical speaker test. |
| `restaurant-recorded-narration-contract` | 3/3 passed, including pause/resume at the same position | Shared player also serves other business guides. |
| Recorded-audio browser smoke | Passed at 1440px and 390px after the player change | Existing restaurant audio regression; construction audio was checked separately. |
| Web gate | `cd apps/web && npm run gate` passed: 3,868 pure tests, 3,858 passed, 10 skipped, 0 failed; typecheck and optimized production build passed. Log: `.test-output/building-materials-learning-gate-final-pass.log`. | Pure/build evidence, not production rollout. |
| Learning browser smoke | First run verified all nine dedicated articles in Thai and English, Thai MP3 and English speech controls, and inventory regression. Its final public-home navigation check timed out while waiting for the page `load` event. The script now waits for `domcontentloaded` and then the footer elements it actually asserts. The full retest passed, including 1440/1024/390/320px routes, navigation, all dedicated articles in both languages, Thai/English play controls, full-screen focus, sitemap and no-JavaScript mobile navigation. Log: `.test-output/building-materials-learning-browser-retest.log`. | The first timeout was a browser-smoke wait condition, not a product assertion failure. |

Local desktop/mobile screenshots were visually inspected for the hero, pilot badge, Flow and
lesson list. Chrome verified an unmuted Thai MP3 advanced its `currentTime`, with matching cue,
transcript and focused node; the decoded clip had nonzero waveform energy. Browser speech synthesis
reported active English narration, and pausing froze the cue until resumed. A simulated missing
MP3 returned an error state rather than leaving “playing” visible. No human speaker-output or
physical scanner/scale/printer validation was performed. No customer message or production deploy
occurred.

## Verification before the branch-selector follow-up

| Command / surface | Exit and observed result | Evidence and limit |
| --- | --- | --- |
| `cd apps/web && npm run gate` | Exit 0; 3,870 pure tests, 3,860 pass, 10 skip, 0 fail; release registry, regression inventory, typecheck and production build passed | `.test-output/building-materials-gate-final-frozen-2026-11-19.log`; this is not a DB or deployment check. |
| `apps/mobile` typecheck and Jest | Exit 0; 61 suites and 481/481 tests passed after POS GraphQL supplier count and nullable legacy input were regenerated | `.test-output/building-materials-mobile-final-verified-2026-11-19.log`; no physical device test. |
| `apps/desktop` node tests | Exit 0; 164/164 passed | `.test-output/building-materials-desktop-final-2026-11-19.log`; no packaging/printing device check. |
| Purchase browser smoke | Exit 0; Thai and English at 1440px and 390px, 4/4 passes for package form, receipt, unknown cost, retry, tenant switch and storage failure | `.test-output/purchase-supplier-browser-final-2026-11-19.log`; API responses were mocked. |
| Throwaway PostgreSQL contracts | Supplier unit 1/1; stock integrity 17/17; quotation 8/8; weighted kilogram 6/6; AR 26/26; sourced specs 6/6, each exit 0 on local `bms_realtime_test` | Migration `10.137` rerun exit 0; schema readiness 242 checks, 0 missing. These suites did not exercise a live store, carrier, payment provider or hardware. |
| Word guide render | Exit 0; eight A4 pages; all pages inspected in Thai, final PO pages 4–5 re-rendered after branch copy | Temporary fontconfig gave headless LibreOffice access to macOS Thai fonts. Review PDF/PNGs under ignored `.test-output/docx-review/withfonts/`. |

The first public Learning Center rerun after supplier copy exited 0: nine dedicated articles in
both Thai and English, 1440/1024/390/320px routes, Thai MP3 and English speech controls, full
screen focus, sitemap and no-JavaScript mobile navigation. Log:
`.test-output/building-materials-learning-browser-final-2026-11-19.log`. The branch-selection
guide copy is rerun separately below. No external message, production migration or deployment
was performed.

## Receiving-branch selection follow-up

The Admin PO receipt now queries only active branches available to the authenticated receiver
using `purchase.receive`, selects the sole available branch automatically, and requires an
explicit choice when there are several. GraphQL and REST forward that branch to the existing
receiving service; the server checks current branch access inside the stock transaction.
The chosen branch is frozen with the receipt retry payload, so a reload does not redirect a
receipt to another branch. A browser storage failure blocks submission before stock changes.
POS receiving still uses its device-bound branch. No migration was required for this follow-up.

| Check | Observed result | Limit |
| --- | --- | --- |
| Narrow pure contracts | `stock-integrity-contract` 43/43; receiving-location resolver requires `purchase.receive`, derives tenant/user from auth, hides inactive locations, and REST/GraphQL reject malformed branch IDs before service writes | Adapter checks plus the existing service branch guard; not a live store. |
| Throwaway DB | Supplier-unit contract 1/1 after adding scoped allowed-branch receipt, denied-branch rollback and replay after access changes | Local `bms_realtime_test`; no production DB or physical goods. |
| Admin browser | 4/4 Thai/English at 1440/390px; branchless receipt rejected, selected branch frozen across retry, supplier package receipt, blocked submission on storage failure and modal width passed | Mocked GraphQL/API responses; `.test-output/purchase-supplier-browser-branch-storage-retest-2026-11-19.log`. The preceding run failed only because its new `Close` locator matched two buttons; selecting the footer button fixed the smoke, then all four combinations passed. |
| Word guide | Eight A4 pages after the branch copy; page 4–5 rendered and visually inspected with Thai fonts, readable and unclipped | PDF/PNGs under ignored `.test-output/docx-review/branch-final/`. |

The public Learning Center rerun after the branch guide copy exited 0. It verified all nine
dedicated articles in Thai and English, 1440/1024/390/320px routes, the Thai MP3 and English
speech controls, Flow focus, sitemap and no-JavaScript mobile navigation. Log:
`.test-output/building-materials-learning-browser-branch-final-2026-11-19.log`.
The final `cd apps/web && npm run gate` run after this follow-up exited 0: release feature
registry, regression inventory, typecheck, 3,872 pure tests (3,862 passed, 10 skipped,
0 failed) and the optimized production build all passed. Log:
`.test-output/building-materials-gate-commit-final-2026-11-19.log`.

Before committing, a boundary audit found an unkeyed staff receipt could skip the service's
branch check. Both staff REST and GraphQL now reject an absent or malformed stable receipt key
before calling the service, including legacy base-unit PO lines. The narrow
`stock-integrity-contract` retest passed 43/43 with explicit missing-key and malformed-branch
cases. The interrupted Web gate run before this fix is not counted as final; the passing
result above is from the corrected code.

## Release decision

Do **not** mark `building_materials` production-ready. Close the missing money/stock workflows in
the table, then run a real store scenario for cement bags/pallets, separate paint sizes, serial
tools, weighed sand, cable cut/remnant, revised project quote, contractor credit, partial PO receipt,
multi-trip delivery, partial return and VAT. A shop must approve unit/rounding/credit/freight rules;
an accountant must approve tax document presentation; carrier/payment providers must validate their
actual contracts; and scale, scanner, printer, truck/POD hardware needs physical acceptance.
