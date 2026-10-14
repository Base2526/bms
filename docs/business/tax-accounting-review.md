# Tax policy decisions awaiting accounting review

Status: **pending accounting confirmation**, 2026-10-14. No tax-point policy is changed by
migration `10.60` or the document-controls UI. This is a decision record, not an accounting opinion
or evidence that the software satisfies every tax obligation.

## Decisions to record

| Scenario | Current BMS behaviour | Accountant to confirm |
| --- | --- | --- |
| POS sale | Settlement completes the order and issues the configured abbreviated document in the same transaction | Document eligibility and tax point for the shop's actual goods/services |
| Online/delivery paid before completion | Full invoice remains blocked until `COMPLETED`; no automatic abbreviated invoice outside POS | Whether payment, delivery, title transfer or another event triggers an earlier document; partial payments and mixed goods/services |
| Services, advances, deposits | No new tax-point behaviour; deposits remain liabilities | Which receipts are taxable consideration versus refundable security; timing, taxable amount and cancellation evidence |
| Full invoice requested after sale | Actual issue date; abbreviated replacement retains the original sale in its original tax-report period | Policy, evidence and timing for requests crossing a month |
| Request after a partial return | Full issuance remains blocked; original document plus credit note retained | A permitted customer document workflow without reopening the returned sale |
| Buyer correction | Paper-only correction: new number, original document date, unchanged money/seller, actual processing-date audit/report note | Retained-original and signature procedure; electronic documents use the provider's procedure |
| Price credit/debit | Human preview/confirmation, original invoice, reason/evidence, event date; no cash/stock/AR movement | Eligible reasons, evidence, amount, payment/receivable handling and exceptions |
| Period close | Immutable sales/input VAT report versions; later changes detected on archive review | Reviewer, filing version, retention/backups and amended filings outside BMS |

Record approver name/role, decision date, affected channels and examples with expected document
dates, tax periods and amounts. Then update `AGENTS.md`, `agent-invariants.md`, services, API tests
and the manual together. This page does not authorize backdating a first invoice, issuing on
`PAID`/`SHIPPED`, or bypassing return/refund guards.

## Source material for the accountant

- [Revenue Code sections 78–78/1](https://www.rd.go.th/5205.html): tax liability events.
- [Revenue Code section 86 and following](https://www.rd.go.th/5208.html): documents and substitutes.
- [Order P.86/2542 clauses 25–26](https://www.rd.go.th/3568.html): correction/replacement procedure.
- [VAT notification 36](https://www.rd.go.th/3401.html): substitute number, date, reason, signature
  and report annotation. A selectable “COPY” label is not this procedure.
- [Order P.80/2542](https://www.rd.go.th/3574.html): adjustment reasons, periods and document details.

## Verification boundary

The user requested **no database use** for this implementation round. Migration `10.60` is provided
but not applied. Pure service tests use simulated query results and failure injection; they do not
prove PostgreSQL syntax, constraints, RLS/grants, concurrency or rollback. Do not label DB checks as
passed. Future authorized verification should use a restored throwaway BMS database, compare a
baseline, apply the migration twice, then exercise role/tenant/branch isolation, simultaneous
issuance, duplicate confirmation and audit failure. Never run these against production.
