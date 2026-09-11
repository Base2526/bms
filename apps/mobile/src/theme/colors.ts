// สีของแอป — ยกค่ามาจาก apps/web/app/globals.css (:root / html.dark) ตรง ๆ
// เพื่อให้ RN กับเว็บ POS เดิมมีภาษาสีเดียวกัน ไม่ใช่ดีไซน์คนละชุด
// ⚠️ ถ้าแก้ palette ของเว็บ ให้ไล่แก้ไฟล์นี้คู่กันด้วย — ยังไม่มีการ sync อัตโนมัติ

export type ColorScheme = 'light' | 'dark';

export interface AppColors {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textSoft: string;
  textInverse: string;
  border: string;
  overlay: string;

  primary: string;
  primaryText: string; // ตัวหนังสือบนพื้น primary (ต้องอ่านออกทั้งสองธีม)

  success: string;
  danger: string;
  warning: string;

  // พื้นอ่อนของป้ายสถานะ (badge/chip) — ไม่ใช่สีข้อความ
  successBg: string;
  dangerBg: string;
  warningBg: string;

  // สีพื้น/สีเส้นของ "ช่องรูปอาหาร" บนการ์ดเมนู วนตามสถานีครัว
  // ยกรูปแบบมาจาก MENU_CARD_TINTS ของ /pos/restaurant บนเว็บ (4 ค่า วนตามลำดับสถานีที่เจอ
  // ไม่ผูกกับชื่อสถานี เพราะแต่ละร้านตั้งชื่อเอง) แต่ค่าสีมาจากพาเลตต์ของแอปนี้ ไม่ได้ก็อป
  // พาเลตต์เขียวของหน้าเว็บมา — ไม่งั้นจะมีสองภาษาสีในแอปเดียว
  // ⚠️ tint ตัวแรกตั้งใจให้เท่ากับ surface2 (สถานีที่เป็นกลาง) — การ์ดจึงต้องมีเส้นคั่น 1px
  // ระหว่างรูปกับช่องข้อความเสมอ ไม่งั้นสองส่วนกลืนเป็นผืนเดียว (บทเรียนจากเว็บ)
  menuTints: Array<{ bg: string; ink: string }>;
}

export const lightColors: AppColors = {
  bg: '#f8fafc',
  surface: '#ffffff',
  surface2: '#f1f5f9',
  surface3: '#e2e8f0',
  text: '#0f172a',
  textSecondary: 'rgba(15, 23, 42, 0.74)',
  textMuted: '#64748b',
  textSoft: 'rgba(15, 23, 42, 0.52)',
  textInverse: '#ffffff',
  border: 'rgba(15, 23, 42, 0.12)',
  overlay: 'rgba(15, 23, 42, 0.28)',

  primary: '#1677ff',
  primaryText: '#ffffff',

  success: '#059669',
  danger: '#dc2626',
  warning: '#d97706',

  successBg: '#ecfdf5',
  dangerBg: '#fef2f2',
  warningBg: '#fffbeb',

  menuTints: [
    { bg: '#f1f5f9', ink: '#1677ff' },
    { bg: '#fef2f2', ink: '#dc2626' },
    { bg: '#fffbeb', ink: '#d97706' },
    { bg: '#ecfdf5', ink: '#059669' },
  ],
};

export const darkColors: AppColors = {
  bg: '#0f172a',
  surface: '#111827',
  surface2: '#0b1220',
  surface3: '#0a0f1a',
  text: '#f8fafc',
  textSecondary: 'rgba(248, 250, 252, 0.80)',
  textMuted: '#94a3b8',
  textSoft: 'rgba(248, 250, 252, 0.62)',
  textInverse: '#0f172a',
  border: 'rgba(148, 163, 184, 0.24)',
  overlay: 'rgba(15, 23, 42, 0.72)',

  primary: '#1677ff',
  primaryText: '#ffffff',

  success: '#34d399',
  danger: '#f87171',
  warning: '#fbbf24',

  successBg: 'rgba(52, 211, 153, 0.16)',
  dangerBg: 'rgba(248, 113, 113, 0.16)',
  warningBg: 'rgba(251, 191, 36, 0.16)',

  menuTints: [
    { bg: '#0b1220', ink: '#60a5fa' },
    { bg: '#2a1a1a', ink: '#f87171' },
    { bg: '#2b2313', ink: '#fbbf24' },
    { bg: '#11291f', ink: '#34d399' },
  ],
};

export function colorsFor(scheme: ColorScheme): AppColors {
  return scheme === 'dark' ? darkColors : lightColors;
}
