import { createRealtimeDiagnosticTracker } from '../src/graphql/realtimeDiagnosticTracker';

describe('realtime diagnostic transitions', () => {
  it('records a WebSocket outage and recovery across a connecting hop', () => {
    const track = createRealtimeDiagnosticTracker();
    expect(track('connecting', 100_000)).toBeNull();
    expect(track('connected', 100_100)).toBeNull();
    expect(track('degraded', 100_200)).toMatchObject({ action: 'realtime.disconnected',
      previousState: 'connected', nextState: 'degraded', errorCode: 'POS_REALTIME' });
    expect(track('reconnecting', 100_300)).toBeNull();
    expect(track('connecting', 100_400)).toBeNull();
    expect(track('connected', 100_500)).toMatchObject({ action: 'realtime.recovered',
      previousState: 'reconnecting', nextState: 'connected', errorCode: 'POS_RECOVERED' });
    expect(track('connected', 100_600)).toBeNull();
  });

  it('reports authentication failure even during the reconnect throttle window', () => {
    const track = createRealtimeDiagnosticTracker();
    expect(track('degraded', 100_000)?.errorCode).toBe('POS_REALTIME');
    expect(track('authentication_required', 100_010)).toMatchObject({
      action: 'realtime.disconnected', errorCode: 'POS_AUTHENTICATION',
    });
  });
});
