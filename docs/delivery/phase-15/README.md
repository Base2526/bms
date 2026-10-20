# Phase 15 — reproducible build verification

Status: **CURRENT LOCAL BUILD REPRODUCIBLE; PRODUCTION NO-GO**.

Phase 15 runs the pinned Fleet Delivery build twice and requires the exact same six output files and
SHA-256 digest for each iteration. Symlinks and unexpected/missing outputs fail closed.

Run `npm run reproducibility:verify`. The command invokes only the fixed `npm run build` command from
the contract; policy data cannot inject a shell command. Fleet Delivery CI runs the verifier after
the normal gate.

This check proves deterministic output on the current machine/toolchain inputs. It does not prove
cross-platform reproducibility, hermetic networking, compiler provenance, image reproducibility,
artifact signing or runtime equivalence. Those claims require separate evidence.

The driver app additionally bundles Android and iOS JavaScript plus copied assets twice into isolated
temporary directories and requires identical SHA-256 digests. This closes source-bundle drift but is
not a reproducible native APK/IPA, CocoaPods compiler, signing or notarization claim; those remain part
of the blocked mobile release gate.

**NO-GO.** Reproducible bundles do not resolve Phase 9/10 approvals or authorize deployment.
