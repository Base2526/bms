# Phase 12 — supply-chain provenance and reproducibility

Status: **ROOT AND MOBILE PROVENANCE VERIFIED; LOCAL MOBILE PATCH AWAITS SECURITY REVIEW; PRODUCTION NO-GO**.

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
`apps/fleet-delivery-driver` checks all 887 locked packages, exact direct declarations, approved local
workspace links and overrides, HTTPS registry sources, SHA-512 integrity and the one pinned optional
install script. Because upstream has no patched `braces` release, the app pins a private
`braces@3.0.4-bms.1` fork through a direct local dependency and `$braces` override. The fork rejects
brace and parenthesis AST nesting above 100 levels before recursive walkers run; exact source hashes,
license text, installed resolution, normal behavior and malicious-pattern rejection are verified by
`npm run verify:security-patch`. `npm audit --omit=dev` now reports zero vulnerabilities. The audit
boundary still refuses Production until the independent Security gate has an approval; Engineering
evidence is not self-authorization.

**NO-GO.** This evidence supplements Phase 9–11; it does not resolve their authorization, policy or
operational blockers.
