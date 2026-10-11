import EventEmitter from 'eventemitter3';
import {
  NetworkPrinter,
  validatePrinterConfig,
  type PrinterSocket,
} from '../src/lib/networkPrinter';

const config = { host: '192.168.1.40', port: 9100, paperWidth: 80 as const };
class FakeSocket extends EventEmitter {
  destroyed = false;
  writes: Uint8Array[] = [];
  statuses: Record<number, number | null> = { 1: 0x12, 2: 0x12, 4: 0x12 };
  rejectConnect = false;
  failWrite = false;
  connect(_config: unknown, callback: () => void) {
    Promise.resolve().then(() =>
      this.rejectConnect
        ? this.emit('error', new Error('offline'))
        : callback(),
    );
    return this;
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
  write(
    bytes: Uint8Array,
    _encoding: unknown,
    callback?: (error?: Error) => void,
  ) {
    this.writes.push(bytes.slice());
    Promise.resolve().then(() => {
      const status = bytes[0] === 0x10 && bytes[1] === 0x04;
      callback?.(
        !status && this.failWrite ? new Error('connection lost') : undefined,
      );
      if (status && this.statuses[bytes[2]] !== null)
        this.emit('data', new Uint8Array([this.statuses[bytes[2]]!]));
    });
    return true;
  }
}
function setup() {
  const socket = new FakeSocket();
  return {
    socket,
    client: new NetworkPrinter(() => socket as unknown as PrinterSocket),
  };
}
afterEach(() => {
  jest.useRealTimers();
});

test.each([
  '8.8.8.8',
  '127.0.0.1',
  'printer.local',
  '192.168.1.999',
  '192.168.1.01',
  'https://192.168.1.40',
])('rejects non-local or malformed target %s', host => {
  expect(() => validatePrinterConfig({ ...config, host })).toThrow();
});
test.each(['10.0.2.2', '172.16.1.4', '192.168.0.7', '169.254.1.4'])(
  'accepts local IPv4 %s',
  host => {
    expect(validatePrinterConfig({ ...config, host }).host).toBe(host);
  },
);
test('checks port and paper width', () => {
  expect(() => validatePrinterConfig({ ...config, port: 0 })).toThrow();
  expect(() =>
    validatePrinterConfig({ ...config, paperWidth: 90 as 80 }),
  ).toThrow();
});
test('printing is refused before connection without rendering customer data', async () => {
  const { client } = setup();
  const render = jest.fn();
  await expect(client.print(render)).rejects.toThrow();
  expect(render).not.toHaveBeenCalled();
});
test('requires printer, cover and paper replies before enabling printing', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  expect(client.getSnapshot().status).toBe('ready');
  expect(socket.writes.map(b => [...b])).toEqual([
    [16, 4, 1],
    [16, 4, 2],
    [16, 4, 4],
  ]);
  client.disconnect();
  expect(client.getSnapshot().status).toBe('disconnected');
});
test.each([
  [1, 0x1a],
  [2, 0x16],
  [4, 0x72],
])('blocks unhealthy status %s', async (kind, status) => {
  const { client, socket } = setup();
  socket.statuses[kind] = status;
  await expect(client.connect(config)).rejects.toThrow();
  expect(client.getSnapshot().status).toBe('error');
  expect(socket.destroyed).toBe(true);
});
test('an open TCP service without printer status times out closed', async () => {
  jest.useFakeTimers();
  const { client, socket } = setup();
  socket.statuses[1] = null;
  const connecting = client.connect(config);
  const failed = connecting.catch(error => error);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await failed).toEqual(
    expect.objectContaining({ message: expect.stringContaining('ไม่ตอบกลับ') }),
  );
  expect(client.getSnapshot().status).toBe('error');
  jest.useRealTimers();
});
test('a remote disconnect disables the button state', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  socket.emit('end');
  expect(client.getSnapshot().status).toBe('error');
});
test('poll failure invalidates a previously ready printer', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  socket.statuses[4] = 0x72;
  await client.refresh();
  expect(client.getSnapshot().status).toBe('error');
});
test('fresh status is checked before sending a receipt, no receipt sent after paper-out', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  socket.statuses[4] = 0x72;
  await expect(
    client.print(async () => new Uint8Array([27, 64, 7])),
  ).rejects.toThrow('กระดาษ');
  expect(socket.writes.every(b => b[0] === 16)).toBe(true);
});
test('serializes jobs, chunks data, and refuses duplicate taps without retries', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  let finish!: (value: Uint8Array) => void;
  const job = client.print(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await expect(client.print(jest.fn())).rejects.toThrow();
  expect(client.getSnapshot().status).toBe('printing');
  finish(new Uint8Array(10000).fill(0x20));
  await job;
  expect(socket.writes.filter(b => b[0] === 0x20).map(b => b.length)).toEqual([
    4096, 4096, 1808,
  ]);
  expect(client.getSnapshot().status).toBe('ready');
  client.disconnect();
});
test('partial write failure reports unknown outcome and never retries automatically', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  socket.failWrite = true;
  await expect(
    client.print(async () => new Uint8Array(8000).fill(0x20)),
  ).rejects.toThrow('ตรวจกระดาษ');
  expect(socket.writes.filter(b => b[0] === 0x20)).toHaveLength(1);
  expect(client.getSnapshot().status).toBe('error');
});
test('background cancellation during rendering cannot send the old receipt later', async () => {
  const { client, socket } = setup();
  await client.connect(config);
  let finish!: (value: Uint8Array) => void;
  const job = client.print(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const cancelled = job.catch(error => error);
  client.disconnect();
  finish(new Uint8Array([32]));
  expect(await cancelled).toBeInstanceOf(Error);
  expect(socket.writes.every(b => b[0] === 16)).toBe(true);
  expect(client.getSnapshot().status).toBe('disconnected');
});
