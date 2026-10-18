# Phase 12 — supply-chain provenance and reproducibility

Status: **ROOT AND MOBILE PROVENANCE VERIFIED; MOBILE SECURITY BLOCKER OPEN; PRODUCTION NO-GO**.

Phase 12 verifies the Node dependency boundary used by the Fleet Delivery workspace. It does not
attest a container registry, sign an image, approve a dependency or authorize production.

## Controls

- every direct production and development dependency uses an exact version;
- the committed package lock is version 3 and its root declarations match `package.json`;
- non-workspace packages resolve only from an approved HTTPS npm registry prefix;
- every registry artifact carries SHA-512 integrity metadata;
- packages with install scripts are denied unless their exact name/version is documented in the
  narrow allowlist;
- `npm run supply-chain:verify` runs the deterministic lock verifier followed by a high-severity
  production dependency audit.

Current install-script exceptions are pinned `esbuild` and optional macOS `fsevents`. A version
change, new script-bearing dependency, alternate registry or missing integrity value fails closed.

The driver app has an independent native dependency lifecycle and therefore a separate policy at
`mobile-supply-chain-policy.json`. `npm run verify:supply-chain` in
`apps/fleet-delivery-driver` checks all 886 locked packages, exact direct declarations, approved local
workspace links, HTTPS registry sources, SHA-512 integrity and the one pinned optional install
script. The mobile production audit still reports 20 high-severity React Native/Metro/CLI advisories;
`mobile-audit-boundary.json` binds the exact count and upstream advisory set so new or changed findings
fail CI, and it refuses any production-enabled plan while a finding remains. Without a compatible
fixed upstream graph or Security-approved exception, the known findings remain a release blocker.

**NO-GO.** This evidence supplements Phase 9–11; it does not resolve their authorization, policy or
operational blockers.
