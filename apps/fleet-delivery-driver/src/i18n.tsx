import React, { createContext, useContext, useMemo, useState } from 'react';

const messages = {
  th: {
    appName: 'BMS Delivery Driver',
    internalBuild: 'รุ่นทดสอบภายใน',
    activationTitle: 'เชื่อมต่อระบบทดสอบ',
    activationBlocked: 'รุ่น Release ยังไม่เปิดรับบัญชีคนขับจนกว่าจะมีระบบยืนยันตัวตนที่อนุมัติแล้ว',
    debugOnly: 'ข้อมูลด้านล่างใช้ได้เฉพาะ Debug build และไม่ใช่ Production login',
    apiUrl: 'API URL',
    accessToken: 'Access token ชั่วคราว',
    tenantRef: 'Tenant reference',
    branchRef: 'Branch reference',
    connect: 'เชื่อมต่อ',
    storageUnavailable: 'ไม่สามารถอ่านที่เก็บข้อมูลปลอดภัยได้',
    retry: 'ลองใหม่',
    home: 'งานของฉัน',
    sync: 'ศูนย์ซิงก์',
    settings: 'ตั้งค่า',
    online: 'ออนไลน์',
    offline: 'ออฟไลน์',
    busy: 'กำลังส่งงาน',
    refresh: 'รีเฟรช',
    syncing: 'กำลังซิงก์…',
    currentAssignment: 'งานปัจจุบัน',
    noAssignment: 'ยังไม่มีงานที่รับแล้ว',
    offers: 'ข้อเสนองาน',
    noOffers: 'ยังไม่มีข้อเสนองาน',
    accept: 'รับงาน',
    reject: 'ปฏิเสธ',
    pickupDistance: 'ระยะถึงจุดรับ',
    expiresIn: 'เหลือเวลา',
    expired: 'หมดเวลา',
    seconds: 'วินาที',
    startPickup: 'เริ่มเดินทางไปรับสินค้า',
    arrivePickup: 'ถึงจุดรับสินค้าแล้ว',
    atPickupBoundary: 'ถึงขอบเขตระบบทดสอบแล้ว การรับมอบสินค้าและส่งปลายทางยังถูกปิด',
    queuedCommands: 'คำสั่งรอส่ง',
    queueEmpty: 'ไม่มีคำสั่งค้าง',
    syncNow: 'ซิงก์ตอนนี้',
    rejectedCommands: 'คำสั่งที่เซิร์ฟเวอร์ปฏิเสธล่าสุด',
    session: 'การเชื่อมต่อ',
    signOut: 'ล้างข้อมูลทดสอบจากเครื่อง',
    blockedCapabilities: 'ความสามารถที่ยังปิด',
    language: 'ภาษา',
    thai: 'ไทย',
    english: 'English',
    error: 'เกิดข้อผิดพลาด',
    loadError: 'โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ',
    authRequired: 'Access token หมดอายุหรือใช้ไม่ได้',
    secureQueue: 'Queue เก็บเฉพาะคำสั่งอ้างอิง ไม่มีข้อมูลลูกค้า พิกัด รูป หรือข้อมูลการเงิน',
    loading: 'กำลังเปิดที่เก็บข้อมูลปลอดภัย…',
    delivery: 'Delivery',
    latestServerState: 'สถานะล่าสุดจากเซิร์ฟเวอร์',
    neverSynced: 'ยังไม่เคยซิงก์',
    productionLocked: 'Production lock ทำงานอยู่',
    references: 'ขอบเขตการทดสอบ',
    clearQueue: 'ล้าง Queue',
    queuedNotice: 'บันทึกไว้ในเครื่องแล้ว ระบบจะส่งซ้ำด้วย idempotency key เดิม',
    validationFailed: 'ข้อมูลเชื่อมต่อไม่ถูกต้อง',
    command: 'คำสั่ง',
    serverCode: 'รหัสจากเซิร์ฟเวอร์',
    disabledExplanation: 'ต้องผ่านการอนุมัติและทดสอบบนอุปกรณ์จริงก่อนเปิดใช้งาน',
  },
  en: {
    appName: 'BMS Delivery Driver',
    internalBuild: 'Internal test build',
    activationTitle: 'Connect to a test environment',
    activationBlocked: 'Release builds remain locked until an approved driver identity service exists.',
    debugOnly: 'The fields below are Debug-only and are not a production login.',
    apiUrl: 'API URL',
    accessToken: 'Temporary access token',
    tenantRef: 'Tenant reference',
    branchRef: 'Branch reference',
    connect: 'Connect',
    storageUnavailable: 'Secure storage is unavailable',
    retry: 'Retry',
    home: 'My work',
    sync: 'Sync center',
    settings: 'Settings',
    online: 'Online',
    offline: 'Offline',
    busy: 'On delivery',
    refresh: 'Refresh',
    syncing: 'Syncing…',
    currentAssignment: 'Current assignment',
    noAssignment: 'No active assignment',
    offers: 'Delivery offers',
    noOffers: 'No offers yet',
    accept: 'Accept',
    reject: 'Reject',
    pickupDistance: 'Pickup distance',
    expiresIn: 'Expires in',
    expired: 'Expired',
    seconds: 'seconds',
    startPickup: 'Start pickup journey',
    arrivePickup: 'Arrived at pickup',
    atPickupBoundary: 'The safe test boundary ends here. Handoff and drop-off remain disabled.',
    queuedCommands: 'Queued commands',
    queueEmpty: 'No queued commands',
    syncNow: 'Sync now',
    rejectedCommands: 'Latest server rejections',
    session: 'Connection',
    signOut: 'Clear test data from this device',
    blockedCapabilities: 'Disabled capabilities',
    language: 'Language',
    thai: 'ไทย',
    english: 'English',
    error: 'Error',
    loadError: 'Unable to load server state',
    authRequired: 'The access token is missing or expired',
    secureQueue: 'The queue stores reference-only commands—never customer data, coordinates, photos, or money.',
    loading: 'Opening secure storage…',
    delivery: 'Delivery',
    latestServerState: 'Latest server state',
    neverSynced: 'Not synced yet',
    productionLocked: 'Production lock is active',
    references: 'Test scope',
    clearQueue: 'Clear queue',
    queuedNotice: 'Saved on this device. It will retry with the original idempotency key.',
    validationFailed: 'The connection details are invalid',
    command: 'Command',
    serverCode: 'Server code',
    disabledExplanation: 'Approval and representative real-device testing are required before enablement.',
  },
} as const;

export type Language = keyof typeof messages;
export type MessageKey = keyof typeof messages.th;

type I18nValue = {
  language: Language;
  setLanguage(language: Language): void;
  t(key: MessageKey): string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('th');
  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: key => messages[language][key],
  }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside LanguageProvider');
  return value;
}
