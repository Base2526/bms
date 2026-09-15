// การแกะ "ลิงก์จับคู่เครื่อง" — โมดูลบริสุทธิ์ ไม่ import อะไรเลย (ทดสอบได้โดยไม่ต้องมี RN)
//
// ⚠️ ต่างจากเว็บตรงจุดสำคัญหนึ่งข้อ: เบราว์เซอร์รู้ origin ของเซิร์ฟเวอร์ฟรี ๆ เพราะหน้า /pos
// ถูกเสิร์ฟมาจากเซิร์ฟเวอร์นั้นอยู่แล้ว **แอปบนไอแพดไม่รู้** — มันเป็นไบนารีที่ไม่ผูกกับโดเมนไหน
// ดังนั้นการจับคู่ของแอปต้องได้ครบ "สองค่า" เสมอ: เซิร์ฟเวอร์ + token
// ลิงก์ที่ดีที่สุดจึงเป็นลิงก์เว็บเต็ม ๆ (`https://ร้าน/pos?t=...`) เพราะพก origin มาให้ในตัว

/** ค่าที่ต้องมีครบถึงจะคุยกับหลังบ้านได้ */
export interface PairingTarget {
  /** origin ของเซิร์ฟเวอร์ เช่น `https://bms.jachoei.com` (ไม่มี / ปิดท้าย) */
  serverUrl: string;
  /** device token ตัวจริง — ค่านี้คือความลับ อย่าเอาไปโชว์ทั้งตัวบนจอ/ล็อก */
  token: string;
}

export type ParsedPairing =
  | { ok: true; token: string; serverUrl: string | null }
  | { ok: false; error: string };

/** token ที่ `issuePosDeviceToken()` ออกให้เป็นรูป `pos_<base64url 32 ไบต์>` เสมอ */
const TOKEN_SHAPE = /^pos_[A-Za-z0-9_-]{16,}$/;

/**
 * ตัด / ปิดท้ายและ path ออกให้เหลือแค่ origin
 * (`https://a.com/pos?t=x` → `https://a.com`) — เก็บ path ไว้ไม่มีประโยชน์และทำให้ประกอบ
 * URL ของ API ผิดทีหลัง
 */
export function normalizeServerUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // ยอมให้พิมพ์แค่โดเมนได้ (คนหน้าร้านไม่พิมพ์ https:// เอง) — เติม https ให้ ไม่ใช่ http
  // เพราะ device token เป็น bearer credential ส่งผ่าน cleartext ไม่ได้
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const m = withScheme.match(/^(https?):\/\/([^/?#\s]+)/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2];
  // credential ใน URL ทำให้ชื่อที่คนเห็นกับ host ที่ fetch ไปคนละตัว จึงไม่รับรูป `good@evil`
  if (authority.includes('@')) return null;
  const local =
    /^localhost(:\d+)?$/i.test(authority) ||
    /^127(?:\.\d{1,3}){3}(:\d+)?$/.test(authority);
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}(:\d+)?$/.test(authority);
  const dns =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(:\d+)?$/i.test(
      authority,
    );
  if (!local && !ipv4 && !dns) {
    return null;
  }
  // bearer token ห้ามวิ่งผ่าน cleartext; ยอม http เฉพาะ loopback สำหรับ dev/simulator
  if (scheme !== 'https' && !local) return null;
  return `${scheme}://${authority}`;
}

/** ดึงค่าของ query param ตัวแรกที่เจอจากรายชื่อที่ให้มา */
function queryParam(input: string, names: string[]): string | null {
  for (const name of names) {
    const m = input.match(new RegExp(`[?&]${name}=([^&#\\s]+)`, 'i'));
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  return null;
}

/**
 * รับได้ 3 รูป เรียงตามที่แนะนำให้ใช้:
 *   1. `bmspos://pair?t=<token>&h=<server>`  — ลิงก์ของแอป (แตะจากอีเมล/แชทแล้วเข้าแอปเลย)
 *   2. `https://<server>/pos?t=<token>`      — ลิงก์ที่หน้าแอดมินคัดลอกให้อยู่แล้ว (พก origin มาด้วย)
 *   3. `pos_xxxxx`                            — token เปล่า ต้องกรอกเซิร์ฟเวอร์แยก
 *
 * ⚠️ ไม่ใช้ `new URL()` โดยตั้งใจ — RN มี URL polyfill ที่ไม่ครบ (`searchParams` ใช้ไม่ได้จริง
 * บนบางเวอร์ชัน) ถ้าพึ่งมันจะพังเงียบ ๆ บนเครื่องจริงแต่ผ่านบน Node ตอนเทส
 */
export function parsePairingInput(raw: string): ParsedPairing {
  const input = raw.trim();
  if (!input) return { ok: false, error: 'ยังไม่ได้ใส่ลิงก์หรือ token' };

  // 1) ลิงก์ของแอปเอง
  if (/^bmspos:\/\//i.test(input)) {
    const token = queryParam(input, ['t', 'token']);
    if (!token)
      return {
        ok: false,
        error: 'ลิงก์ bmspos:// นี้ไม่มีค่า t= (token) อยู่ในนั้น',
      };
    if (!TOKEN_SHAPE.test(token))
      return {
        ok: false,
        error: `ค่า t= ในลิงก์ไม่ใช่ token ของเครื่องขาย (ต้องขึ้นต้นด้วย pos_)`,
      };
    const host = queryParam(input, ['h', 'host', 'server']);
    return {
      ok: true,
      token,
      serverUrl: host ? normalizeServerUrl(host) : null,
    };
  }

  // 2) ลิงก์เว็บ — เอา origin มาเป็นเซิร์ฟเวอร์ด้วย
  if (/^https?:\/\//i.test(input)) {
    const token = queryParam(input, ['t', 'token']);
    if (!token) {
      return {
        ok: false,
        error:
          'ลิงก์นี้ไม่มีค่า t= (token) — คัดลอก “ลิงก์จับคู่” จากหน้าเครื่องขายในระบบหลังบ้าน',
      };
    }
    if (!TOKEN_SHAPE.test(token))
      return {
        ok: false,
        error:
          'ค่า t= ในลิงก์ไม่ใช่ token ของเครื่องขาย (ต้องขึ้นต้นด้วย pos_)',
      };
    return { ok: true, token, serverUrl: normalizeServerUrl(input) };
  }

  // 3) token เปล่า
  if (TOKEN_SHAPE.test(input))
    return { ok: true, token: input, serverUrl: null };

  if (input.startsWith('pos_')) {
    return {
      ok: false,
      error: 'token สั้นเกินไปหรือมีอักขระแปลกปน — คัดลอกมาไม่ครบหรือเปล่า',
    };
  }
  return {
    ok: false,
    error:
      'อ่านค่านี้ไม่ออก — วางลิงก์จับคู่ทั้งลิงก์ หรือ token ที่ขึ้นต้นด้วย pos_',
  };
}

/**
 * รูปที่เอาไปโชว์บนจอได้ — **ห้ามโชว์ token เต็มตัวที่ไหนทั้งสิ้น**
 * (จอ POS อยู่กลางร้าน ใครเดินผ่านก็ถ่ายรูปได้ และ token ตัวนี้ไม่มีวันหมดอายุ)
 * ท้าย 6 ตัวพอให้เทียบกับหน้าแอดมินว่าเป็นตัวเดียวกันไหมตอนไล่ปัญหา
 */
export function maskToken(token: string): string {
  if (!token) return '—';
  return token.length <= 6 ? '••••' : `••••${token.slice(-6)}`;
}

/** ตัด scheme ออกให้อ่านง่ายบนจอแคบ (`https://a.com` → `a.com`) */
export function displayHost(serverUrl: string): string {
  return serverUrl.replace(/^https?:\/\//i, '');
}
