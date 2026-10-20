# Phase 9 certification evidence packets

These packets define the review question, required outputs, exercise and acceptance boundary for each
blocked pilot gate. They are plans, not accepted evidence. Never add a reviewer name, approval or
`PASS` status without a durable report from the authorized owner named in `readiness-gates.json`.

Use synthetic or explicitly approved non-production data only. Do not store credentials, customer
PII, precise real-driver location, private evidence or raw security findings in this repository.
Link protected evidence through an authorized HTTPS system and keep a redacted decision record here.

For each gate:

1. Execute the packet with the named owners.
2. Record durable evidence references in `readiness-gates.json` and `certification-workbook.json`.
3. Add approvals only after the owner signs the same reviewed evidence.
4. Change both gate and workbook status together.
5. Run `npm run certification:verify` and `npm run pilot:readiness`.

`PILOT_READY` does not authorize production; Phase 10 still requires separate authorization.

The files under `../approval-requests/` are outbound request drafts, not accepted evidence. Sending,
acknowledging or discussing a packet does not add an approval. Only a real authorized owner may sign
the reviewed evidence, after which the durable evidence reference and approval are recorded in the
authoritative readiness manifest.
