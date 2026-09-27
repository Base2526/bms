import type { DeliveryProvider } from "./types";

export type ProviderOnboardingState =
  | "TENANT_CONFIGURATION_AVAILABLE"
  | "PARTNER_CONTRACT_REQUIRED";

export type TenantSetupMode = "CREDENTIAL_FORM" | "PLACEHOLDER_ONLY";

export type DeliveryProviderOnboarding = Readonly<{
  state: ProviderOnboardingState;
  tenantSetupMode: TenantSetupMode;
  /** Credential ownership cannot be selected until the signed provider contract says who owns it. */
  credentialAuthority: "TENANT" | "UNDECIDED_PENDING_CONTRACT";
  officialContract: string;
}>;

/**
 * This is product truth, not rollout state. In particular, the presence of a provider in the
 * tenant form does not mean BMS has a partner agreement or knows its authentication contract.
 */
export const DELIVERY_PROVIDER_ONBOARDING: Readonly<Record<DeliveryProvider, DeliveryProviderOnboarding>> = {
  FOODPANDA: {
    state: "TENANT_CONFIGURATION_AVAILABLE",
    tenantSetupMode: "CREDENTIAL_FORM",
    credentialAuthority: "TENANT",
    officialContract: "https://developer.foodpanda.com/api-specifications",
  },
  GRABFOOD: {
    state: "PARTNER_CONTRACT_REQUIRED",
    tenantSetupMode: "PLACEHOLDER_ONLY",
    credentialAuthority: "UNDECIDED_PENDING_CONTRACT",
    officialContract: "https://github.com/grab/grabfood-api-sdk-java",
  },
  LINEMAN: {
    state: "PARTNER_CONTRACT_REQUIRED",
    tenantSetupMode: "PLACEHOLDER_ONLY",
    credentialAuthority: "UNDECIDED_PENDING_CONTRACT",
    officialContract: "Partner-only contract pending",
  },
};

export function tenantCredentialFormAvailable(provider: DeliveryProvider) {
  return DELIVERY_PROVIDER_ONBOARDING[provider].tenantSetupMode === "CREDENTIAL_FORM";
}

export function assertTenantDeliveryConfigurationAllowed(
  provider: DeliveryProvider,
  input: Readonly<{
    rolloutMode: "OFF" | "SHADOW" | "LIVE";
    active: boolean;
    outboundCommandsEnabled: boolean;
    credentialValues: readonly unknown[];
    config: Readonly<Record<string, unknown>>;
    apiVersion: string | null;
    credentialExpiresAt: string | null;
  }>,
) {
  if (tenantCredentialFormAvailable(provider)) return;
  if (input.rolloutMode !== "OFF" || input.active || input.outboundCommandsEnabled) {
    throw new Error("DELIVERY_PLATFORM_PARTNER_ONBOARDING_REQUIRED");
  }
  const suppliedTenantCredential = input.credentialValues.some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (suppliedTenantCredential || Object.keys(input.config).length > 0
    || input.apiVersion || input.credentialExpiresAt) {
    throw new Error("DELIVERY_TENANT_CREDENTIALS_NOT_AUTHORIZED");
  }
}
