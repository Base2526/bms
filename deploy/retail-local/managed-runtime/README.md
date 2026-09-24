# BMS Retail Local Managed Runtime

This directory incubates the signed, one-click runtime for commercial self-install releases. It does
not replace the existing Docker Desktop technical-pilot installer yet.

## First certified targets

- supported Windows 11 x64 releases: private WSL2 distribution + Moby;
- Windows 10 IoT Enterprise LTSC 2021 x64: the fixed-purpose appliance target;
- Windows 10 22H2 x64: transition only, with current ESU evidence;
- Ubuntu 24.04 LTS x64: primary native-Linux target;
- Ubuntu 22.04 LTS x64: transition target.

`support-matrix.json` is product policy, not a claim that a target has passed certification. The
installer must also require a signed release manifest whose `platformTarget` names one of these
entries. A future Windows release is not supported merely because its build number is higher.

## Trust boundary

The host agent owns runtime lifecycle, downloads, signature verification, backup/update orchestration,
and health reporting. Electron remains a client window and never receives a Docker/Moby socket,
database credential, price rule, or settlement authority.

Every downloaded release is a JWS-compatible Ed25519 envelope described by
`release-manifest.schema.json`; the decoded body follows `release-payload.schema.json`. The signature
covers the exact ASCII `protected.payload` bytes, avoiding cross-language JSON canonicalization
ambiguity. Each component also has a SHA-256; OCI images additionally require an immutable digest.
HTTPS alone, tags, and a checksum downloaded beside an artifact are not publisher identity.

`verify-release.mjs` is the dependency-free reference verifier for release tooling and tests. The
future native agent must implement the same verify-before-parse order with an embedded keyring; a
public-key path supplied beside the manifest is suitable for tooling, not the customer trust root.

The release private key belongs only in the signing service. It must never be present in this
repository, an installer, an image, or a target shop. Key rotation uses a new embedded public key id
in a signed agent release before manifests start using that id.

## Milestone 1

The first slice is deliberately read-only:

- machine-readable support policy;
- signed release-envelope schema;
- Windows and Linux candidate preflight scripts;
- contract tests that keep unsupported/EOL targets and mutable image references out.

The current `deploy/retail-local/install.ps1` remains the technical-pilot path until the native host
agent, reboot-resume state machine, backup/restore recovery, and clean-machine acceptance matrix are
implemented and evidenced.

Run the Linux candidate check with:

```bash
bash deploy/retail-local/managed-runtime/preflight-linux.sh
```

Run the Windows candidate check from PowerShell 7 with:

```powershell
pwsh .\deploy\retail-local\managed-runtime\preflight-windows.ps1 -Json
```
