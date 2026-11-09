# Release feature control

This is the release inventory for **known code capabilities**, not a production enablement list.
The current registry has `scope: baseline-in-progress`. Do not publish its count as the number of
all BMS features or claim that an `AVAILABLE` entry is active for every tenant.

## Sources and identity

- `apps/web/lib/bms/assistantKnowledge/capabilities.ts` supplies its stable capability IDs,
  product status, English title, and configuration dependencies. It is a product catalog, not a
  live tenant query.
- `scripts/release-feature-registry.json` adds workflows outside that catalog, with stable IDs,
  source paths, test links, and requirements. Add or update an entry in the same change as a new
  workflow. Do not reuse an ID after removal.
- `docs/feature-inventory.md` remains a human-readable business inventory. Its aggregate numbers
  are a dated snapshot and have not been reconciled with every current feature. Reconcile it
  domain by domain before changing the registry scope to `complete`.

The registry check validates duplicate IDs, status values, repository source paths and test paths.
It fails if the count of features without feature-level test links grows beyond the recorded
baseline. Existing missing links remain visible in every manifest; a catalog contract alone is
not evidence that each business operation works.

## Before release

1. Merge changes, then select the **exact clean commit** to release. `npm run gate` checks the
   registry, regression-file inventory, Web types, all database-free contracts, and the Web production build. Mobile,
   desktop, DB, browser, and real-provider/hardware checks remain separate. Run the suites for
   the changed domains on isolated test infrastructure. DB suites write data and must never run
   on production.
2. From the repo root, run:

   ```text
   node apps/web/node_modules/tsx/dist/cli.mjs scripts/release-features.mts --version <release-id> --output .test-output/release
   ```

   Add `--previous <path-to-prior-release-features.json>` for the `added/changed/removed` diff.
   A dirty working tree is refused. `--allow-dirty` is only for a local draft and is marked in
   the output. GitHub Web gate uploads a candidate manifest after its checks pass.
3. Review `release-features.md` and the JSON artifact. Verify the changed feature IDs and the
   missing-test list. Record DB, browser, mobile and desktop results for the **same commit**.
4. Run `scripts/preflight-deploy.mts` against the intended environment. Confirm migrations,
   configuration and flags there. Record the artifact digest, commit, deployment target and
   rollout state after deployment. The release manifest does not perform these target checks.

## Reading status

`AVAILABLE`, `CONDITIONAL`, `BETA`, and `MOCK` come from the existing capability catalog.
Additional registry entries may use `PILOT` or `WIP`. These are **code/product statuses**.
Production availability additionally requires the deployed artifact, target schema, flags,
provider configuration, package entitlement, permissions and rollout evidence. In particular,
`inventory.transfer-lots` remains WIP until production deployment is verified, and Retail Local
remains a pilot.

`feature_policy_version` on a tenant is the package-entitlement policy version; it is not the
application release version. A migration filename is a dependency, not proof that the migration
was applied to production. The version and commit in the manifest identify source code; a
deployment record must identify the running artifact and target environment.

## Remaining work before a complete inventory

- Reconcile every row of `docs/feature-inventory.md` and newer domain docs with stable IDs,
  including features that are not in the assistant catalog. Remove the `baseline-in-progress`
  scope only after that review.
- Add specific test links for the existing unmapped capabilities and require relevant DB/browser/
  native evidence when changed. The current Web gate does not run those suites.
- Persist production deployment records and the effective per-tenant flag/entitlement state.
  A code manifest alone cannot answer what a particular tenant can use right now.
