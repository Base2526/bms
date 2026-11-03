import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button } from './Button';
import {
  displayHost,
  redactDeviceToken,
  type PairingTarget,
} from '../lib/pairing';
import { parsePairingQr } from '../../../../packages/pos-client-core/src/pairingQr';

interface Props {
  target: PairingTarget | null;
  disabled?: boolean;
  pair: (target: PairingTarget) => Promise<void>;
  onPaired: () => void;
  onBusyChange: (busy: boolean) => void;
}

function sameTarget(a: PairingTarget | null, b: PairingTarget | null) {
  return a?.serverUrl === b?.serverUrl && a?.token === b?.token;
}

/** Separate from product scanning: credentials must never enter SKU lookup or scan history. */
export function PairingScannerButton(props: Props) {
  const latest = useRef(props);
  const pairingVersion = useRef(0);
  // Compare every observed change, not just the final value: A -> B -> A invalidates old scans too.
  if (
    !sameTarget(latest.current.target, props.target) ||
    latest.current.disabled !== props.disabled
  ) {
    pairingVersion.current += 1;
  }
  latest.current = props;
  const mounted = useRef(true);
  const focused = useRef(false);
  const generation = useRef(0);
  const locked = useRef(false);
  const cancelConfirmation = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Settings may stay mounted while its phone/tablet layout replaces this child.
      // Release our busy state now; the old asynchronous finally must not touch a new scanner.
      if (locked.current) latest.current.onBusyChange(false);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
        generation.current += 1;
        // iOS does not guarantee an Alert onDismiss callback when its presenting screen leaves.
        cancelConfirmation.current?.();
      };
    }, []),
  );

  async function scan() {
    if (locked.current || latest.current.disabled || !focused.current) return;
    locked.current = true;
    setBusy(true);
    latest.current.onBusyChange(true);
    const attempt = generation.current;
    const version = pairingVersion.current;
    const previous = latest.current.target;
    const active = () => focused.current && generation.current === attempt;
    const unchanged = () =>
      active() &&
      version === pairingVersion.current &&
      !latest.current.disabled &&
      sameTarget(previous, latest.current.target);
    let candidate: PairingTarget | null = null;
    try {
      // Lazy loading also leaves manual pairing usable on binaries without the native scanner.
      const { DataScanner } =
        require('react-native-data-scanner') as typeof import('react-native-data-scanner');
      if (!unchanged()) return;
      const result = await DataScanner.scanBarcode({
        targetFormats: ['qr'],
        qualityLevel: 'balanced',
        enableAutoZoom: true,
      });
      if (!result?.value || !unchanged()) return;
      candidate = parsePairingQr(result.value);
      if (!candidate) {
        Alert.alert(
          'QR จับคู่ไม่ถูกต้อง',
          'ใช้ QR จากหน้าเครื่องขายในระบบหลังบ้านที่เปิดผ่าน HTTPS ต้องมีทั้งเซิร์ฟเวอร์และ token ครบถ้วน',
        );
        return;
      }
      if (previous && !sameTarget(previous, candidate)) {
        const confirmed = await new Promise<boolean>(resolve => {
          const cancel = () => finish(false);
          const finish = (accepted: boolean) => {
            // A late callback from an older native alert must not clear a newer confirmation.
            if (cancelConfirmation.current === cancel)
              cancelConfirmation.current = null;
            resolve(accepted);
          };
          cancelConfirmation.current = cancel;
          Alert.alert(
            'เปลี่ยนการจับคู่เครื่อง?',
            `เดิม: ${displayHost(previous.serverUrl)}\nใหม่: ${displayHost(
              candidate!.serverUrl,
            )}\nจะตรวจและใช้ token จาก QR แทนตัวเดิม`,
            [
              {
                text: 'ยกเลิก',
                style: 'cancel',
                onPress: cancel,
              },
              { text: 'เปลี่ยนการจับคู่', onPress: () => finish(true) },
            ],
            { cancelable: true, onDismiss: cancel },
          );
        });
        if (!confirmed || !unchanged()) return;
      }
      // Existing provider verifies with the server, checks pending cash, then writes the keystore.
      await latest.current.pair(candidate);
      if (!active()) return;
      latest.current.onPaired();
      Alert.alert(
        'จับคู่สำเร็จ',
        'บันทึก token แล้ว กลับหน้าเข้าสู่ระบบและใช้ PIN พนักงานเพื่อเริ่มขาย',
      );
    } catch (error) {
      if (!active()) return;
      const message = error instanceof Error ? error.message : '';
      if (!candidate && /cancell?ed/i.test(message)) return;
      Alert.alert(
        candidate ? 'จับคู่ไม่สำเร็จ' : 'เปิดกล้องสแกนไม่ได้',
        candidate
          ? redactDeviceToken(message, candidate.token) ||
              'ตรวจ token หรือบันทึกไม่สำเร็จ กรุณาลองใหม่'
          : 'ตรวจสิทธิ์กล้องและความพร้อมของเครื่อง หากยังสแกนไม่ได้ให้คัดลอกลิงก์จับคู่จากหลังบ้านมาวาง',
      );
    } finally {
      locked.current = false;
      // This component can remain mounted on a blurred native-stack screen.
      if (mounted.current) {
        setBusy(false);
        latest.current.onBusyChange(false);
      }
    }
  }

  return (
    <Button
      label="สแกน QR เพื่อจับคู่"
      onPress={() => {
        scan();
      }}
      disabled={props.disabled}
      loading={busy}
      fullWidth
    />
  );
}
