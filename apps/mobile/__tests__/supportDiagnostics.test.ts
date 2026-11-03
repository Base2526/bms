import * as Keychain from 'react-native-keychain';
import { recordPosDiagnosticEvent } from '../src/lib/supportDiagnostics';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn().mockResolvedValue(true),
  resetGenericPassword: jest.fn().mockResolvedValue(true),
}));

test('redacts new and restored diagnostic events before persistence and transport', async () => {
  const target = {
    serverUrl: 'https://shop.example.test',
    token: `pos_${'a'.repeat(43)}`,
  };
  let finish!: (body: string) => void;
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_url, init) => {
      finish(String(init?.body));
      return { ok: true, status: 200 } as Response;
    });
  try {
    let sent = new Promise<string>(resolve => {
      finish = resolve;
    });
    recordPosDiagnosticEvent(target, {
      category: 'pos',
      action: 'pos.device.verify',
      status: 'error',
      message: `Rejected ${target.token} ${'x'.repeat(550)}`,
      context: { errorCode: target.token },
    });
    expect(await sent).not.toContain(target.token);
    const firstWrite = (Keychain.setGenericPassword as jest.Mock).mock.calls[0];
    const legacy = [
      {
        eventId: 'legacy',
        occurredAt: '2026-11-03T00:00:00Z',
        category: 'pos',
        action: 'pos.device.verify',
        status: 'error',
        message: target.token,
        context: { errorName: target.token },
      },
    ];
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
      username: firstWrite[0],
      password: JSON.stringify(legacy),
    });
    sent = new Promise<string>(resolve => {
      finish = resolve;
    });
    recordPosDiagnosticEvent(target, {
      category: 'pos',
      action: 'pos.device.verify',
      status: 'info',
      message: 'Retry',
    });
    const body = await sent;
    expect(body).toContain('legacy');
    expect(body).not.toContain(target.token);
    const writes = (Keychain.setGenericPassword as jest.Mock).mock.calls.map(
      ([, value]) => value,
    );
    expect(JSON.stringify(writes)).not.toContain(target.token);
    expect(JSON.parse(writes[0])[0].message.length).toBeLessThanOrEqual(500);
    // Credentials still belong in authenticated transport headers, never event bodies.
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual(
      expect.objectContaining({ 'x-pos-device-token': target.token }),
    );
  } finally {
    fetchMock.mockRestore();
  }
});
