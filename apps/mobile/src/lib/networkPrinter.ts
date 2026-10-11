/* eslint-disable no-bitwise -- ESC/POS status is a documented bit mask. */
import type Socket from 'react-native-tcp-socket/lib/types/Socket';

export type PrinterConfig = { host: string; port: number; paperWidth: 58 | 80 };
export type PrinterState = {
  status: 'disconnected' | 'connecting' | 'ready' | 'printing' | 'error';
  message: string;
  config: PrinterConfig | null;
};
export type PrinterSocket = Pick<
  Socket,
  | 'connect'
  | 'on'
  | 'once'
  | 'removeListener'
  | 'write'
  | 'destroy'
  | 'destroyed'
>;

export function validatePrinterConfig(value: PrinterConfig): PrinterConfig {
  const host = value.host.trim();
  const parts = host.split('.');
  const octets = parts.map(Number);
  const local =
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254);
  if (
    parts.length !== 4 ||
    parts.some(p => !/^(0|[1-9]\d{0,2})$/.test(p)) ||
    octets.some(n => n > 255) ||
    !local
  ) {
    throw new Error('กรุณาระบุ IPv4 ของเครื่องพิมพ์ในเครือข่ายภายใน');
  }
  if (
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535
  ) {
    throw new Error('พอร์ตต้องเป็นจำนวนเต็มระหว่าง 1024–65535');
  }
  if (value.paperWidth !== 58 && value.paperWidth !== 80) {
    throw new Error('กรุณาเลือกกระดาษ 58 หรือ 80 มม.');
  }
  return { host, port: value.port, paperWidth: value.paperWidth };
}

export class NetworkPrinter {
  private state: PrinterState = {
    status: 'disconnected',
    message: 'ยังไม่ได้เชื่อมต่อเครื่องพิมพ์',
    config: null,
  };
  private socket: PrinterSocket | null = null;
  private listeners = new Set<() => void>();
  private pending = new Set<(error: Error) => void>();
  private operating = false;

  constructor(private createSocket: () => PrinterSocket) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(status: PrinterState['status'], message: string) {
    this.state = { ...this.state, status, message };
    this.listeners.forEach(listener => listener());
  }
  disconnect = (message = 'ยังไม่ได้เชื่อมต่อเครื่องพิมพ์') => {
    const socket = this.socket;
    this.socket = null;
    this.pending.forEach(reject => reject(new Error(message)));
    socket?.destroy();
    this.update('disconnected', message);
  };
  private fail(socket: PrinterSocket, error: unknown) {
    if (this.socket !== socket) return;
    const message =
      error instanceof Error ? error.message : 'เชื่อมต่อเครื่องพิมพ์ไม่ได้';
    this.disconnect(message);
    this.update('error', message);
  }
  private assertConnected(socket: PrinterSocket) {
    if (this.socket !== socket || socket.destroyed)
      throw new Error('การเชื่อมต่อเครื่องพิมพ์ถูกยกเลิก');
  }
  private wait<T>(
    start: (
      resolve: (value: T) => void,
      reject: (error: Error) => void,
    ) => (() => void) | void,
    ms = 4000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      let cleanup: (() => void) | void;
      let done = false;
      const finish = (error?: Error, value?: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.pending.delete(cancel);
        cleanup?.();
        if (error) reject(error);
        else resolve(value as T);
      };
      const cancel = (error: Error) => finish(error);
      const timer = setTimeout(
        () =>
          cancel(
            new Error(
              'เครื่องพิมพ์ไม่ตอบกลับ ตรวจ Wi-Fi, IP และสิทธิ์เครือข่ายภายใน',
            ),
          ),
        ms,
      );
      this.pending.add(cancel);
      try {
        cleanup = start(value => finish(undefined, value), cancel);
        if (done) cleanup?.();
      } catch (error) {
        cancel(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  private async statusByte(socket: PrinterSocket, kind: 1 | 2 | 4) {
    this.assertConnected(socket);
    return this.wait<number>((resolve, reject) => {
      const onData = (data: Uint8Array | string) => {
        // DLE EOT replies have fixed bits 0xx1xx10; never accept a TCP handshake as printer readiness.
        if (typeof data === 'string') return;
        const byte = Array.from(data).find(n => (n & 0x93) === 0x12);
        if (byte !== undefined) resolve(byte);
      };
      socket.on('data', onData);
      socket.write(new Uint8Array([0x10, 0x04, kind]), undefined, error => {
        if (error) reject(error);
      });
      return () => {
        socket.removeListener('data', onData);
      };
    });
  }
  private async health(socket: PrinterSocket) {
    const online = await this.statusByte(socket, 1);
    const cause = await this.statusByte(socket, 2);
    const paper = await this.statusByte(socket, 4);
    this.assertConnected(socket);
    if (cause & 0x04) throw new Error('ฝาเครื่องพิมพ์เปิดอยู่');
    if (paper & 0x60 || cause & 0x20) throw new Error('กระดาษเครื่องพิมพ์หมด');
    if (online & 0x68 || cause & 0x48)
      throw new Error('เครื่องพิมพ์ออฟไลน์หรือมีข้อผิดพลาด');
  }
  async connect(input: PrinterConfig) {
    if (this.operating) throw new Error('เครื่องพิมพ์กำลังทำงาน');
    const config = validatePrinterConfig(input);
    this.disconnect();
    this.state = { ...this.state, config };
    this.update('connecting', 'กำลังเชื่อมต่อและตรวจสถานะเครื่องพิมพ์');
    this.operating = true;
    let socket: PrinterSocket | undefined;
    try {
      socket = this.createSocket();
      this.socket = socket;
      const current = socket;
      socket.on('error', error => this.fail(current, error));
      socket.on('close', () =>
        this.fail(
          current,
          new Error('การเชื่อมต่อเครื่องพิมพ์หลุด กรุณาเชื่อมต่อใหม่'),
        ),
      );
      socket.on('end', () =>
        this.fail(current, new Error('เครื่องพิมพ์ปิดการเชื่อมต่อ')),
      );
      await this.wait<void>(resolve => {
        current.connect(
          { host: config.host, port: config.port, connectTimeout: 5000 },
          () => resolve(),
        );
      }, 6000);
      await this.health(socket);
      this.update('ready', 'เชื่อมต่อเครื่องพิมพ์แล้ว');
    } catch (error) {
      if (socket) this.fail(socket, error);
      else
        this.update(
          'error',
          'โมดูลเครื่องพิมพ์ไม่พร้อม กรุณาติดตั้งแอปเวอร์ชันใหม่',
        );
      throw error;
    } finally {
      this.operating = false;
    }
  }
  async refresh() {
    if (this.operating || this.state.status !== 'ready' || !this.socket) return;
    this.operating = true;
    const socket = this.socket;
    try {
      await this.health(socket);
    } catch (error) {
      this.fail(socket, error);
    } finally {
      this.operating = false;
    }
  }
  async print(render: (config: PrinterConfig) => Promise<Uint8Array>) {
    if (this.operating)
      throw new Error('กำลังตรวจสถานะเครื่องพิมพ์ กรุณาลองอีกครั้ง');
    if (this.state.status !== 'ready' || !this.socket || !this.state.config) {
      throw new Error('ยังไม่ได้เชื่อมต่อเครื่องพิมพ์');
    }
    this.operating = true;
    const socket = this.socket;
    this.update('printing', 'กำลังส่งงานพิมพ์');
    let wrote = false;
    try {
      const config = this.state.config;
      const bytes = await this.wait<Uint8Array>((resolve, reject) => {
        render(config).then(resolve, reject);
      }, 15000);
      if (!bytes.length || bytes.length > 2_000_000)
        throw new Error('ขนาดงานพิมพ์เกินขอบเขตที่รองรับ');
      await this.health(socket);
      const deadline = Date.now() + 45000;
      for (let offset = 0; offset < bytes.length; offset += 4096) {
        this.assertConnected(socket);
        if (Date.now() > deadline)
          throw new Error('ส่งงานพิมพ์เกินเวลาที่กำหนด');
        wrote = true;
        await this.wait<void>((resolve, reject) => {
          socket.write(
            bytes.subarray(offset, offset + 4096),
            undefined,
            error => (error ? reject(error) : resolve()),
          );
        }, 5000);
      }
      this.assertConnected(socket);
      this.update('ready', 'ส่งข้อมูลแล้ว กรุณาตรวจใบเสร็จที่เครื่องพิมพ์');
    } catch (error) {
      const failure = wrote
        ? new Error(
            'ส่งงานพิมพ์ไม่ครบหรือไม่ทราบผล กรุณาตรวจกระดาษก่อนพิมพ์ซ้ำ',
          )
        : error;
      this.fail(socket, failure);
      throw failure;
    } finally {
      this.operating = false;
    }
  }
}
