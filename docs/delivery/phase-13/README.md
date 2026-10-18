# Phase 13 — secret and sensitive-material hygiene

Status: **STATIC SCOPE VERIFIED; PRODUCTION NO-GO**.

Phase 13 adds a bounded credential-pattern scan over the Fleet Delivery source, infrastructure,
documentation, workflow and verification files. It never prints matched material: findings contain
only rule ID, repository-relative path and line number.

## Controls

- scan roots and text file types are explicit and versioned;
- symlinks, repository escape, binary data and oversized in-scope files fail closed;
- private-key blocks and common AWS, GitHub, Slack, Stripe, Google and npm credential formats are
  detected;
- an exception requires exact rule/path/match-hash plus a reason, and stale exceptions fail;
- `npm run secret-scan:verify` runs locally and in the Fleet Delivery CI gate.

This bounded pattern scan is defense in depth. It does not inspect Git history, ignored local files,
container layers, external secret stores or provider consoles and is not a substitute for key
rotation or an independent security review.

**NO-GO.** No credential finding is permission to expose or rotate a real secret automatically, and
a clean result does not authorize production.
