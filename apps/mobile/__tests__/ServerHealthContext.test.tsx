import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ServerHealthProvider, useServerHealth } from '../src/state/ServerHealthContext';

const mockReject = jest.fn();
let mockDevice: any;
jest.mock('../src/state/DeviceContext', () => ({ useDevice: () => mockDevice }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const onlineBody = { data: { bmsPosSession: { device: { id: 'new-device' } } } };
const response = (body: unknown, status = 200) => ({
  ok: status === 200, status, json: async () => body,
}) as Response;

describe('ServerHealthProvider pairing isolation', () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  let health: ReturnType<typeof useServerHealth>;
  function Probe() { health = useServerHealth(); return null; }
  const render = () => <ServerHealthProvider><Probe /></ServerHealthProvider>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockReject.mockClear();
    mockDevice = {
      status: 'PAIRED', verify: { kind: 'OK' },
      target: { serverUrl: 'https://old.example.com', token: 'old-token' },
      markAuthenticationRejected: mockReject,
    };
  });
  afterEach(async () => {
    await act(async () => tree?.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test.each(['headers', 'body'])('ignores an old 401 at the %s boundary after re-pairing', async stage => {
    const oldHeaders = deferred<Response>();
    const oldBody = deferred<unknown>();
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => stage === 'headers'
        ? oldHeaders.promise
        : Promise.resolve({ ok: true, status: 200, json: () => oldBody.promise } as Response))
      .mockResolvedValue(response(onlineBody));
    await act(async () => { tree = ReactTestRenderer.create(render()); });
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    mockDevice = { ...mockDevice, target: { serverUrl: 'https://new.example.com', token: 'new-token' } };
    await act(async () => tree.update(render()));
    expect(oldSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(health.status).toBe('online');
    await act(async () => {
      oldHeaders.resolve(response(null, 401));
      oldBody.resolve({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] });
    });
    expect(mockReject).not.toHaveBeenCalled();
    expect(health.status).toBe('online');
  });

  test('an old completion cannot clear the new in-flight probe', async () => {
    const old = deferred<Response>();
    const next = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await act(async () => { tree = ReactTestRenderer.create(render()); });
    mockDevice = { ...mockDevice, target: { ...mockDevice.target, token: 'new-token' } };
    await act(async () => tree.update(render()));
    await act(async () => { old.resolve(response(onlineBody)); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = health.checkNow(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve(response(onlineBody)); await pending; });
    expect(health.status).toBe('online');
  });

  test('does not probe a rejected token and clears previous online evidence on unpair', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response(onlineBody));
    await act(async () => { tree = ReactTestRenderer.create(render()); });
    expect(health.lastOnlineAt).not.toBeNull();
    mockDevice = { ...mockDevice, verify: { kind: 'REJECTED' } };
    await act(async () => tree.update(render()));
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(health.status).toBe('offline');
    expect(health.lastOnlineAt).toBeNull();
  });
});
