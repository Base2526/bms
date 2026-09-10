import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { clearPairing, loadPairing, savePairing } from '../lib/deviceStore';
import type { PairingTarget } from '../lib/pairing';

// "เครื่องนี้เป็นของร้านไหน" — state ระดับแอป
//
// หลักการที่ยกมาจากฝั่งเว็บทั้งดุ้น: **แอปไม่ได้ประกาศว่าตัวเองเป็นของร้านไหน**
// มันถือแค่ token แล้ว server เป็นคนตอบว่า token นี้เป็นของร้านไหน/สาขาไหน ทุกคำขอ
// (`authenticatePosDevice` ใน apps/web/lib/bms/pos.ts) — ไม่มี route ไหนรับ tenant จาก client

/** ผลของการถาม server ว่า "เครื่องนี้คือใคร" — แต่ละแบบพาไปทำคนละอย่าง */
export type VerifyState =
  | { kind: 'IDLE' }
  | { kind: 'CHECKING' }
  | { kind: 'OK'; info: DeviceIdentity }
  /** 401 — token ถูกยกเลิกหรือมีการออก token ใหม่ให้เครื่องนี้ ต้องไปจับคู่ใหม่ */
  | { kind: 'REJECTED'; message: string }
  /** เซิร์ฟเวอร์ตอบ แต่ตอบว่าพัง (5xx / เจอหน้า HTML แทน JSON เพราะ URL ผิด) */
  | { kind: 'SERVER_ERROR'; message: string }
  /** ต่อไม่ถึงเลย — **ห้ามอ่านว่า token ผิด** (บทเรียนของเว็บ: เน็ตร้านสะดุดทีเดียว
   *  แล้วไล่พนักงานไปจับคู่ใหม่กลางกะ คือทางที่ทำให้ร้านเลิกเชื่อหน้าจอ) */
  | { kind: 'OFFLINE'; message: string };

export interface DeviceIdentity {
  deviceCode: string;
  deviceName: string | null;
  branchName: string | null;
  branchCode: string | null;
  /** retail | restaurant — ฝั่ง server ตัดสินจาก business_archetype ของร้าน */
  surface: string | null;
  shiftOpen: boolean;
  cashierCount: number;
}

export type PairingStatus = 'LOADING' | 'UNPAIRED' | 'PAIRED' | 'UNAVAILABLE';

interface DeviceContextValue {
  status: PairingStatus;
  target: PairingTarget | null;
  /** เหตุผลที่อ่านค่าจาก Keychain ไม่ได้ — ต่างจาก "ยังไม่เคยจับคู่" */
  storeError: string | null;
  verify: VerifyState;
  pair: (target: PairingTarget) => Promise<void>;
  unpair: () => Promise<void>;
  runVerify: () => Promise<void>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

/** fetch ไม่มี timeout ในตัว — คำขอที่ค้างครึ่งทาง (เน็ตร้านหลุดกลางคัน) จะทำให้ปุ่ม
 *  "ทดสอบการเชื่อมต่อ" หมุนค้างตลอดกาลโดยไม่มีอะไรบอก */
const VERIFY_TIMEOUT_MS = 10_000;

export function DeviceProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PairingStatus>('LOADING');
  const [target, setTarget] = useState<PairingTarget | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyState>({ kind: 'IDLE' });
  // กันผลของรอบเก่ามาเขียนทับรอบใหม่ (กดทดสอบรัว ๆ ตอนเน็ตช้า)
  const verifySeq = useRef(0);
  // แยกจาก status เพราะการเปลี่ยน token ขณะที่ status ยังเป็น PAIRED
  // ก็ต้องตรวจ token ใหม่ โดยไม่รอ effect นี้ยิงซ้ำ
  const verifiedOnce = useRef(false);

  useEffect(() => {
    let alive = true;
    async function restorePairing() {
      const res = await loadPairing();
      if (!alive) return;
      if (res.status === 'PAIRED') {
        setTarget(res.target);
        setStatus('PAIRED');
      } else if (res.status === 'UNPAIRED') {
        setStatus('UNPAIRED');
      } else {
        setStoreError(res.error);
        setStatus('UNAVAILABLE');
      }
    }
    restorePairing().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const unpair = useCallback(async () => {
    await clearPairing();
    // ถ้ามีคำขอ verify ค้างอยู่ ผลของมันต้องหมดสิทธิ์ทันทีที่เลิกจับคู่
    verifySeq.current += 1;
    setTarget(null);
    setStatus('UNPAIRED');
    setStoreError(null);
    setVerify({ kind: 'IDLE' });
  }, []);

  const verifyTarget = useCallback(async (candidate: PairingTarget) => {
    const seq = ++verifySeq.current;
    setVerify({ kind: 'CHECKING' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch(`${candidate.serverUrl}/api/pos/session`, {
        headers: { 'x-pos-device-token': candidate.token },
        signal: controller.signal,
      });
      if (seq !== verifySeq.current) return;

      if (res.status === 401) {
        setVerify({
          kind: 'REJECTED',
          message:
            'เซิร์ฟเวอร์ไม่รับ token ของเครื่องนี้ — มักเกิดจากมีคนกด “ออก token” ใหม่ให้เครื่องนี้ ตัวเก่าจะใช้ไม่ได้ทันที',
        });
        return;
      }
      if (!res.ok) {
        setVerify({
          kind: 'SERVER_ERROR',
          message: `เซิร์ฟเวอร์ตอบ HTTP ${res.status}`,
        });
        return;
      }

      // URL ที่ชี้ผิดโดเมนมักตอบ 200 พร้อมหน้า HTML — ถ้าไม่ดักตรงนี้จะได้ error ของ JSON parser
      // ที่อ่านไม่รู้เรื่อง ทั้งที่ปัญหาจริงคือ "ใส่เซิร์ฟเวอร์ผิด"
      const body = await res.json().catch(() => null);
      if (!body || typeof body !== 'object' || !body.device) {
        setVerify({
          kind: 'SERVER_ERROR',
          message:
            'ที่อยู่นี้ตอบกลับมาไม่ใช่ข้อมูลของเครื่องขาย — ตรวจว่าใส่เซิร์ฟเวอร์ถูกตัวหรือยัง',
        });
        return;
      }

      setVerify({
        kind: 'OK',
        info: {
          deviceCode: String(body.device.code ?? '—'),
          deviceName: body.device.name ?? null,
          branchName: body.location?.name ?? null,
          branchCode: body.location?.branchCode ?? null,
          surface: body.surface ?? null,
          shiftOpen: Boolean(body.shift),
          cashierCount: Array.isArray(body.cashiers) ? body.cashiers.length : 0,
        },
      });
    } catch (e: any) {
      if (seq !== verifySeq.current) return;
      const aborted = e?.name === 'AbortError';
      setVerify({
        kind: 'OFFLINE',
        message: aborted
          ? `ไม่ได้คำตอบภายใน ${
              VERIFY_TIMEOUT_MS / 1000
            } วินาที — เน็ตช้าหรือเซิร์ฟเวอร์ไม่ตอบ`
          : `ต่อเซิร์ฟเวอร์ไม่ได้ (${String(e?.message ?? e)})`,
      });
    } finally {
      clearTimeout(timer);
    }
  }, []);

  const runVerify = useCallback(async () => {
    if (!target) return;
    await verifyTarget(target);
  }, [target, verifyTarget]);

  const pair = useCallback(
    async (next: PairingTarget) => {
      await savePairing(next);
      setTarget(next);
      setStatus('PAIRED');
      setStoreError(null);
      // pair() ตรวจ candidate โดยตรง ไม่อ่าน target จาก closure รอบเก่า
      // (ก่อนแก้ การจับคู่ครั้งแรกไม่ verify อะไร และการเปลี่ยน token อาจ verify ตัวเก่า)
      verifiedOnce.current = true;
      await verifyTarget(next);
    },
    [verifyTarget],
  );

  // ถามเซิร์ฟเวอร์หนึ่งครั้งตอนเปิดแอปถ้าเครื่องจับคู่ไว้แล้ว — หน้า Login จะได้บอกได้ว่า
  // "เครื่องนี้เป็นของสาขาไหน" ตั้งแต่ก่อนใครกดอะไร (เว็บก็เรียก /api/pos/session ตอน mount เหมือนกัน)
  // เครื่องที่ยังไม่จับคู่ไม่ยิงอะไรเลยสักคำขอ
  useEffect(() => {
    if (status !== 'PAIRED' || verifiedOnce.current) return;
    verifiedOnce.current = true;
    runVerify().catch(() => undefined);
  }, [status, runVerify]);

  const value = useMemo<DeviceContextValue>(
    () => ({ status, target, storeError, verify, pair, unpair, runVerify }),
    [status, target, storeError, verify, pair, unpair, runVerify],
  );

  return (
    <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error('useDevice ต้องถูกเรียกใต้ <DeviceProvider>');
  return ctx;
}
