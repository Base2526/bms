import type { VerifiedSocialIdentity } from "./social";

export type SocialLinkDecision = "MATCHED" | "LINK" | "CONFLICT";

export function socialLinkDecision(
  user: { provider?: unknown; provider_id?: unknown },
  identity: VerifiedSocialIdentity,
): SocialLinkDecision {
  const provider = String(user.provider ?? "password").trim().toLowerCase() || "password";
  const providerId = String(user.provider_id ?? "").trim();

  if (provider === identity.provider && providerId === identity.provider_id) return "MATCHED";
  if ((provider === "password" && !providerId) || (provider === identity.provider && !providerId)) {
    return "LINK";
  }
  return "CONFLICT";
}
