import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import * as Keychain from 'react-native-keychain';
import {
  NetworkPrinter,
  validatePrinterConfig,
  type PrinterConfig,
  type PrinterState,
} from '../lib/networkPrinter';
import { useDevice } from './DeviceContext';

const SERVICE = 'com.bms.pos.network-printer.v1';
type Value = {
  state: PrinterState;
  saved: PrinterConfig | null;
  storageWarning: string | null;
  connect: (config: PrinterConfig) => Promise<void>;
  disconnect: () => void;
  print: NetworkPrinter['print'];
};
const PrinterContext = createContext<Value | null>(null);

export function PrinterProvider({ children }: { children: React.ReactNode }) {
  const { target } = useDevice();
  const clientRef = useRef<NetworkPrinter | null>(null);
  if (!clientRef.current)
    clientRef.current = new NetworkPrinter(() => new TcpSocket.Socket());
  const client = clientRef.current;
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [saved, setSaved] = useState<PrinterConfig | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const configured = useRef(false);

  useEffect(() => {
    let active = true;
    Keychain.getGenericPassword({ service: SERVICE })
      .then(value => {
        if (
          active &&
          !configured.current &&
          value &&
          value.username === 'printer'
        ) {
          setSaved(validatePrinterConfig(JSON.parse(value.password)));
        }
      })
      .catch(() => {
        /* An unreadable preference must never enable printing. */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    client.disconnect();
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active')
        client.disconnect('แอปพักการเชื่อมต่อ กรุณาเชื่อมต่อเครื่องพิมพ์ใหม่');
    });
    const poll = setInterval(() => {
      client.refresh();
    }, 5000);
    return () => {
      clearInterval(poll);
      subscription.remove();
      client.disconnect();
    };
  }, [client, target?.serverUrl, target?.token]);

  const connect = async (input: PrinterConfig) => {
    const config = validatePrinterConfig(input);
    configured.current = true;
    await client.connect(config);
    setSaved(config);
    setStorageWarning(null);
    try {
      const result = await Keychain.setGenericPassword(
        'printer',
        JSON.stringify(config),
        {
          service: SERVICE,
          accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
        },
      );
      if (!result) throw new Error('บันทึกเครื่องพิมพ์ไม่ได้');
    } catch {
      setStorageWarning(
        'บันทึกค่าลงเครื่องไม่ได้ การเชื่อมต่อนี้ใช้ได้เฉพาะรอบที่เปิดแอปอยู่',
      );
    }
  };
  return (
    <PrinterContext.Provider
      value={{
        state,
        saved,
        storageWarning,
        connect,
        disconnect: client.disconnect,
        print: render => client.print(render),
      }}
    >
      {children}
    </PrinterContext.Provider>
  );
}

export function usePrinter() {
  const value = useContext(PrinterContext);
  if (!value) throw new Error('PrinterProvider is missing');
  return value;
}
