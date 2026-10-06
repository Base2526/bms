export const MANAGED_RUNTIME_TARGETS = [
  "windows-11-x64",
  "windows-10-iot-enterprise-ltsc-2021-x64",
  "windows-10-22h2-esu-x64",
  "ubuntu-24.04-lts-x64",
  "ubuntu-22.04-lts-x64",
  "macos-15-arm64",
  "macos-15-x64",
  // Public hosting alias for the legacy POS-only manifest. It is never a server target;
  // the signed payload must say windows-10-x86-pos.
  "windows-10-x86",
] as const;

export type ManagedRuntimeTarget = typeof MANAGED_RUNTIME_TARGETS[number];

export const MANAGED_RUNTIME_REQUIRED_COMPONENTS = {
  web: "oci-image",
  ws: "oci-image",
  postgres: "oci-image",
  redis: "oci-image",
  runtime: "runtime",
  compose: "support-file",
  desktop: "desktop",
  "shop-archetypes": "support-file",
} as const;

export const MANAGED_RUNTIME_PUBLIC_METADATA_FILES = ["release.jws.json", "SHA256SUMS"] as const;

export function managedRuntimeSignedTarget(target: ManagedRuntimeTarget): string {
  return target === "windows-10-x86" ? "windows-10-x86-pos" : target;
}
