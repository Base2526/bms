# Global Work Assistant — full-system V1 coverage

Status: implemented and contract-checked. The deterministic catalog currently contains 45 verified
capabilities, 94 bilingual guides, 20 verified FAQ answers, and 19 groups of limits and traps
(97 rules). Every literal Admin Sidebar
destination and every routable Admin page except `/admin` (redirect) and `/admin/login` has a
guide, either directly or through its parent detail route. POS has dedicated register guides for
Sale, Payment, Return/Void, no-receipt return, Receive, Deposits, Shift reports, scanner/device
settings, members/coupons/points, parked bills, receipts/display, expenses/petty cash, drawer
movement and no-sale, credit sale and receivable collection, gift cards/store credit, and
pharmacist counter authorization — one for each register workflow that has an `/api/pos/*` route.

“Whole system” has three deliberately different coverage levels:

1. **Capability and how-to coverage — complete for current routable Admin/POS surfaces.** The
   assistant can explain what each menu does, prerequisites, steps, limitations, and the correct
   route without an AI key. New Sidebar/page routes fail the deterministic contract until a guide is
   added.
2. **Live read coverage — only approved backend tools.** Current tools cover product/catalog/stock,
   coupons and customer eligibility, customer loyalty points and tenant loyalty settings, orders,
   reports/dashboard, customers, shipments, payments, purchases/suppliers, staff lookup/effective
   access, store/payment/shipping information, forecasting, and bounded conversation summaries.
3. **Action coverage — approved mutations only.** Money, stock, deletion, refunds, cancellation,
   merge, report email, and customer messaging stay propose-only and require the existing
   permission-gated confirmation mutation.

Pages such as Audit, Revisions, Commission, Follow-up, Pharmacy, platform observability, ENV, logs,
and dev tools have verified usage guidance, but do not automatically gain a new live-data AI tool.
If no approved tool exists, the assistant must say that live state cannot be checked from chat and
link the authorized user to the real page. Guide coverage is never permission to query a table.

The assistant keeps four questions separate:

1. Does BMS implement the capability? Read the capability catalog.
2. Has this tenant configured or enabled it? Read a trusted tenant-scoped service/tool.
3. Is there live data now? Read an approved business tool.
4. May this actor see or do it? Derive role, platform status, and effective permissions on the
   server, then re-check tool permission immediately before execution.

`AVAILABLE` means the core workflow exists. `CONDITIONAL` needs tenant configuration, a feature
gate, device/shift state, or a connected service. `BETA` means the code is written but has never
been verified end to end against the real external system (e-Tax signing/submission, Shopee/Lazada
signature verification, ESC/POS hardware). `MOCK` means scaffolding exists but the external
integration is not live at all (Flash/Kerry booking). A menu rendering is never evidence that
configuration is healthy.

A status describes one capability, not a whole module: shipment creation and tracking is
`AVAILABLE` while `shipping.carrier-integrations` stays `MOCK`, because a single entry cannot
honestly say both.

## Module coverage summary

| Area | Verified coverage | Important boundary |
| --- | --- | --- |
| Dashboard / Reports | KPIs, export XLSX/CSV/PDF, email proposal, scheduled-report explanation | Figures require live report tools; PDF headings remain English |
| Inbox / Restock / Follow-up | Inbox operations, mentions, realtime diagnostics, restock and follow-up guides | Realtime diagnostics never contacts customers; holdout rows cannot be contacted |
| Products / Packs / Labels | Catalog, stock, imports, packs and label guidance | Pack pieces/price are resolved server-side; AI never supplies them |
| Orders / Payments / Shipping | Lifecycle reads and approved create/update/proposal tools | Shipment creation/tracking is available; Flash/Kerry booking stays MOCK; payment methods come from tenant configuration |
| Purchase / Inventory / Locations | PO tools, receiving, branch transfer and snapshot-count guides | Transfers are send/receive; counts apply variance, not an absolute overwrite |
| Customers / Coupons / Loyalty | CRM reads, customer coupon wallet/check, shop-wide current coupons, point balance and tenant program status | Active shop coupon is not customer eligibility; product loyalty support is not tenant enablement |
| Users / Permissions / Audit | Tenant staff lookup, self/selected-user effective access, permission/audit/revision guides | Staff existence requires `user.view`; role rank and Administrator/platform guards remain separate |
| POS | Dedicated deterministic guide assistant for every primary menu plus capabilities for deposits, store credit, expense, return/void, tax and e-Tax | POS-only users never enter `/admin`; the register surface serves only register guides (`pageId === "pos"`), never POS back-office pages; device token is not a user; second-person PIN rules remain |
| Pharmacy | Intake, queue, protocol, license, mockup, manual, and evidence boundaries | AI makes no clinical decision; evidence has a narrower permission than case access |
| Settings / Billing / AI | Channels, payment configuration, BYOK, billing, AI Quality and Playground | Secrets never appear in answers; provider choice never widens RBAC |
| Platform / System | Architecture, tenants, roles, posts, files, logs, mail, support, cron, health, ENV, SQL console and fake-data guides | Links are visible only to platform administrators; System Health stays read-only |

## Verified FAQ

The short question/answer pairs staff ask most (`lib/bms/assistantKnowledge/faq.ts`) used to exist
only inside `/admin/manual`, which meant the assistant could not answer them: someone who asked the
Drawer "กดจัดส่งไม่ได้ ขึ้นว่าไม่มีที่อยู่" got generic guide steps while the exact answer sat on a page
they did not have open. Each FAQ now names the guide that owns it, and:

- `/admin/manual` renders the same array — there is no second copy of an answer to drift,
- retrieval folds each FAQ's question and its staff phrasings into the owning guide's alias pool,
  so real wording reaches the right guide,
- `search_system_guides` returns them, so the model quotes a verified answer instead of composing
  a second version of it out of the steps,
- with no AI provider, a matched FAQ answer leads the deterministic reply.

FAQ *answers* are deliberately excluded from retrieval scoring. They are long prose; scoring them
would make every answer a weak match for every question, which is the "it found something" failure
this catalog exists to prevent. Questions and aliases are the retrieval keys; the answer is the
payload. The register surface is untouched: every FAQ today belongs to a back-office guide, and a
cashier must not be handed one.

Generic questions now match nothing rather than the first entry that shares a filler word. "What
can I do on this page?" is built entirely from words that carry no topic; before the stopword
filter it scored `pos.device-settings` as a real answer. On a page it becomes page guidance; with
no page it reaches the honest empty answer.

## Verified limits and traps

`lib/bms/assistantKnowledge/limits.ts` holds the 19 groups (97 rules) that used to exist only in
`/admin/manual`: the stock invariant and its movement types, barcode rules, which numbers are
estimates, cancel vs return vs refund, coupon ordering, FEFO lots and snapshot counts, what is not
supported yet, permissions by module, and the rest. A guide says what to do; these say what will
bite, and without them the assistant could explain how to run a profit report while never
mentioning that it applies today's cost to last month's revenue.

Each group names the guides it constrains, the Manual renders the same array, and
`search_system_guides` returns the groups belonging to its two best-ranked guides — only two,
because 97 rules would crowd out the answer they exist to protect. Rules are payload and are never
scored; group titles and staff phrasings are the retrieval keys, the same contract as the FAQ.

## Required ambiguity behavior

- “ร้านมีคนชื่อ suprims ไหม” must distinguish staff from customer. Staff existence requires
  `user.view`; customer lookup requires `customer.view`. A denied actor learns neither result.
- “มีคูปองอะไรใช้ได้บ้าง” without a customer means shop-wide generally available coupons. For a
  named customer, resolve identity and re-check wallet, quota, per-customer limit, minimum spend,
  and prior use. Never present the first result as the second.
- “ระบบมีสะสมแต้มไหม” needs the capability plus live tenant loyalty settings. A customer's point
  balance is a third, separate query.
- Current path, page ID, role, and platform status are retrieval/access context only, and the
  first two are bounded and re-validated server-side. Tool execution still passes the normal
  permission guard.
- An explicit page-deictic help request (for example “หน้านี้ใช้งานอย่างไร” or “What can I do on
  this page?”) resolves deterministically from the validated current route before conversation
  history reaches the model. A previous POS discussion therefore cannot turn Dashboard help into
  a POS answer. Explicitly named workflows such as “ปิดกะ POS ยังไง” still follow normal retrieval
  regardless of the open page. Troubleshooting wording such as “หน้านี้ใช้งานไม่ได้” stays in the
  normal assistant flow, while “ทั้งหมด” / “all features” returns every guide declared for the
  route and labels workflows the actor cannot access without exposing their steps or links.
- Standing on a page re-ranks that page's guides; it never turns them into an answer. A result
  carries `matchedQuery`, and only query-matched entries become citations or links — otherwise
  every guide on the current page would be cited for every message, including "hello".
- Retrieval language is a client-supplied presentation preference (`locale`). `users.language` is
  deliberately not a session claim, so it cannot be read from the GraphQL context.
- Similar staff-name matches are choices, not proof of identity. The assistant never guesses which
  person the user meant.

## Completion and regression gates

All three suites run in `npm run test:pure` (and therefore in CI), not by hand:
`work-assistant-knowledge-contract` (catalog shape and coverage), `work-assistant-surface-contract`
(GraphQL/UI boundaries), and `work-assistant-question-corpus` (what each question must answer).

- Knowledge IDs are unique and Thai/English fields are complete.
- Every permission and alternative permission resolves to `BMS_PERMISSIONS`.
- Every catalog route renders a real page — a directory is not a page, and the assistant hands
  `route` to the user as a link. Documented-but-not-linkable subtrees declare
  `coversRoutePrefixes`.
- Every Sidebar route and Admin page is covered; new pages fail the contract until documented.
- `any_staff`, `tenant_administrator`, `platform_administrator`, and any-of permissions are tested.
- Capability-only and guide-only retrieval are filtered before limiting, so one kind cannot crowd
  out the other.
- Without an AI provider/quota, verified capability/how-to results still return deterministically;
  live data and actions clearly remain unavailable.
- POS primary-menu queries resolve to dedicated guides and `/pos/display` exposes no assistant.
- An unmatched question at the register says so instead of showing the first page guide.
- A proposal in the Drawer shows its mutation and server-composed arguments before Confirm, and an
  emailed report requires a reviewed, valid recipient with an unknown-recipient warning.
- Every question the product asks — the 51 chips and hand-verified questions, plus one coverage
  question for every remaining catalog entry, plus 2 guards that must stay unanswerable (133 in
  `work-assistant-question-corpus.mts`) — is *led* by the entry that answers it. Presence anywhere
  in the result list is not a pass: a guide that slips to rank 6 behind unrelated entries fails,
  which is the regression the earlier `.some(...)` assertions could not see.
- Every guide and every capability has at least one pinned question or FAQ. An entry nobody can
  ask about is unreachable in practice, and unreachable text is where wrong text survives — so a
  new page fails the contract until someone writes the question that should find it.
- Every starter chip the UI ships is a pinned question, so a new chip fails the contract until its
  answer is pinned.
- Every question that can only be answered from live data names an approved tool that exists, is
  offered on the staff surface, and is still gated by the permission written next to it.
- Every FAQ resolves to its own guide in both languages, and every FAQ alias resolves to its own
  FAQ — an alias that answers a different question is worse than no alias.
- Every limit group reaches a guide it constrains, in both languages, and carries the same number
  of rules in Thai and English — a rule that exists in one language is a rule half the staff never
  sees.
- The Manual imports the FAQ and limit catalogs and declares neither array itself, so the page and
  the assistant cannot drift apart.
