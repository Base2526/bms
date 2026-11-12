# Release evidence review

`scripts/release-features.mts` inventories known code capabilities. It cannot say whether a
particular deployment or tenant can use them. `scripts/release-evidence-check.mts` provides a
blank evidence form and flags missing results for the exact release commit. A complete form means
**submitted for review**, not production approval: the reviewer must verify the references,
environment, tenant scope, provider and hardware themselves.

After selecting a clean release commit, generate the release feature manifest as described in
[`release-feature-control.md`](../release-feature-control.md). Then run:

```text
node apps/web/node_modules/tsx/dist/cli.mjs scripts/release-evidence-check.mts --manifest .test-output/release/release-features.json --template .test-output/release/evidence.json
node apps/web/node_modules/tsx/dist/cli.mjs scripts/release-evidence-check.mts --manifest .test-output/release/release-features.json --record .test-output/release/evidence.json --output .test-output/release/evidence-review.json
```

Fill `artifactDigest` with `sha256:<64 hex digits>` of the deployed artifact and `target` with the
specific deployment. For each gate and feature use `PASS`, `FAIL`, or `NOT_APPLICABLE`, an evidence
reference, and a reason for `NOT_APPLICABLE`. A test filename is not a passing test result. Use a
reference to an actual run or review record; do not put tokens, customer data, secrets, or raw
provider responses in the form. Keep the form under `.test-output` or another private evidence
store. The CLI exits 1 and lists missing or failed items until the form is complete. It rejects a
dirty manifest, commit mismatch, unknown feature ID, missing artifact digest, and unexplained
not-applicable result.

The gates are intentionally separate: target schema, configuration, Web, database, browser,
Mobile, Desktop and backup/restore. Schema, configuration, Web, database and backup/restore must
pass; an unused browser or native client can be marked `NOT_APPLICABLE` with a reason. Provider,
pharmacist, tax and hardware acceptance belong in
the relevant feature's evidence reference and the human release decision. The tool never changes
feature flags, applies migrations or deploys software.
