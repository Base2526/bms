import type { MobileRealtimeStatus } from '../lib/realtime';

type Report = { action: 'realtime.disconnected' | 'realtime.recovered';
  status: 'warning' | 'success'; previousState: MobileRealtimeStatus;
  nextState: MobileRealtimeStatus; errorCode: 'POS_REALTIME' | 'POS_AUTHENTICATION' | 'POS_RECOVERED' };

/** A connecting hop must not erase a prior outage before connected is observed. */
export function createRealtimeDiagnosticTracker() {
  let current: MobileRealtimeStatus = 'offline';
  let outage: MobileRealtimeStatus | null = null;
  let lastFailureAt = 0;
  return (next: MobileRealtimeStatus, now = Date.now()): Report | null => {
    const previous = current;
    current = next;
    if (next === 'connected' && outage) {
      const report: Report = { action: 'realtime.recovered', status: 'success',
        previousState: outage, nextState: next, errorCode: 'POS_RECOVERED' };
      outage = null;
      return report;
    }
    if (!['degraded', 'reconnecting', 'authentication_required'].includes(next)) return null;
    outage = next;
    if (next === previous || (next !== 'authentication_required' && now - lastFailureAt < 30_000)) return null;
    lastFailureAt = now;
    return { action: 'realtime.disconnected', status: 'warning', previousState: previous,
      nextState: next, errorCode: next === 'authentication_required' ? 'POS_AUTHENTICATION' : 'POS_REALTIME' };
  };
}
