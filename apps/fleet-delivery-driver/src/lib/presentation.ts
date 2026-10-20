export function formatDistance(distanceM: number): string {
  if (distanceM < 1000) return `${distanceM} m`;
  return `${(distanceM / 1000).toFixed(distanceM < 10_000 ? 1 : 0)} km`;
}

export function offerRemainingSeconds(
  serverNow: string,
  expiresAt: string,
  receivedAtMs: number,
  currentDeviceMs: number,
): number {
  const elapsed = Math.max(0, currentDeviceMs - receivedAtMs);
  const estimatedServerNow = Date.parse(serverNow) + elapsed;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - estimatedServerNow) / 1000));
}

export function describeCommand(kind: string): string {
  if (kind === 'SET_AVAILABILITY') return 'Availability';
  if (kind === 'DECIDE_OFFER') return 'Offer decision';
  if (kind === 'ADVANCE_PICKUP_JOURNEY') return 'Pickup journey';
  return 'Driver command';
}
