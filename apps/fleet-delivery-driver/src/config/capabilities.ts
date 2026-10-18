import { PHASE4_SAFE_CAPABILITIES } from '@bms/fleet-delivery-driver-core';

export const DRIVER_APP_CAPABILITIES = Object.freeze({
  ...PHASE4_SAFE_CAPABILITIES,
  debugActivation: __DEV__,
  syntheticOfferWorkflow: true,
  syntheticPickupJourney: true,
  offlineCommandRecovery: true,
});

export type DriverAppCapability = keyof typeof DRIVER_APP_CAPABILITIES;
