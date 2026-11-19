/** Presentation only. Never infer a rollback or retry a command from a transport failure. */
export type PosFailureKind = 'network' | 'timeout' | 'cancelled' | 'authentication' | 'permission'
  | 'rate_limit' | 'server' | 'protocol' | 'version' | 'business';
export type PosFailure = {
  kind: PosFailureKind;
  code: string;
  httpStatus: number | null;
  outcome: 'unknown' | 'rejected' | 'read_failed';
  message: string;
};

type ErrorShape = {
  name?: string; code?: string; httpStatus?: number; statusCode?: number;
  networkError?: ErrorShape; extensions?: { code?: unknown }; graphQLErrors?: ErrorShape[];
};

/** Input messages, URLs, bodies and variables are deliberately never interpolated. */
export function describePosConnectionFailure(error: unknown, mutation = false,
  translate: (source: string) => string = source => source): PosFailure {
  const outer = (error ?? {}) as ErrorShape;
  const value = outer.networkError ?? outer;
  const status = value.httpStatus ?? value.statusCode;
  const httpStatus = Number.isInteger(status) && status! >= 100 && status! <= 599 ? status! : null;
  const code = value.extensions?.code ?? value.code;
  let kind: PosFailureKind;
  if (httpStatus === 401 || code === 'UNAUTHENTICATED') kind = 'authentication';
  else if (httpStatus === 403 || code === 'FORBIDDEN') kind = 'permission';
  else if (httpStatus === 429 || code === 'TOO_MANY_REQUESTS') kind = 'rate_limit';
  else if (httpStatus === 408 || httpStatus === 504 || code === 'POS_TIMEOUT') kind = 'timeout';
  else if (code === 'POS_CANCELLED' || value.name === 'AbortError') kind = 'cancelled';
  else if ((httpStatus != null && httpStatus >= 500) || code === 'INTERNAL_SERVER_ERROR') kind = 'server';
  else if (code === 'GRAPHQL_VALIDATION_FAILED' || code === 'GRAPHQL_PARSE_FAILED' || httpStatus === 404) kind = 'version';
  else if (code === 'INVALID_RESPONSE' || value.name === 'ServerParseError') kind = 'protocol';
  else if (typeof code === 'string' && ['BAD_USER_INPUT', 'CONFLICT', 'NOT_FOUND'].includes(code)) kind = 'business';
  else if (httpStatus != null || value.extensions) kind = 'protocol';
  else kind = 'network';
  const rejected = ['authentication', 'permission', 'rate_limit', 'version', 'business'].includes(kind);
  const outcome = !mutation ? 'read_failed' : rejected ? 'rejected' : 'unknown';
  const labels: Record<PosFailureKind, [string, string]> = {
    network: ['เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'ตรวจอินเทอร์เน็ต ที่อยู่เซิร์ฟเวอร์ และใบรับรอง HTTPS หากยังไม่หายให้แจ้งผู้ดูแล'],
    timeout: ['เซิร์ฟเวอร์ไม่ตอบภายในเวลาที่กำหนด', 'ตรวจการเชื่อมต่อและสถานะเซิร์ฟเวอร์'],
    cancelled: ['การรอคำตอบถูกยกเลิก', 'ตรวจสถานะล่าสุดก่อนทำรายการต่อ'],
    authentication: ['เซิร์ฟเวอร์ไม่ยอมรับข้อมูลยืนยันเครื่อง', 'ให้ผู้ดูแลตรวจสถานะเครื่องและ token เก็บรายการค้างไว้ก่อนเปลี่ยนการจับคู่'],
    permission: ['ไม่มีสิทธิ์ทำรายการนี้ หรือ PIN ไม่ผ่านการตรวจสอบ', 'ตรวจพนักงาน PIN และสิทธิ์กับผู้ดูแล ไม่จำเป็นต้องเลิกจับคู่เครื่อง'],
    rate_limit: ['ส่งคำขอถี่เกินไป', 'รอสักครู่ก่อนลองอีกครั้ง หลีกเลี่ยงการกดซ้ำถี่ ๆ'],
    server: ['ระบบหลังบ้านขัดข้องชั่วคราว', 'แจ้งผู้ดูแลพร้อมรหัสด้านล่างและเวลาที่เกิดปัญหา'],
    protocol: ['คำตอบจากเซิร์ฟเวอร์ไม่ใช่ข้อมูล POS ที่ถูกต้อง', 'ให้ผู้ดูแลตรวจ URL ระบบ proxy และเวอร์ชันแอปกับหลังบ้าน'],
    version: ['คำขอนี้ไม่ตรงกับ API ของหลังบ้าน', 'ให้ผู้ดูแลตรวจ URL และเวอร์ชันแอปกับหลังบ้าน'],
    business: ['เซิร์ฟเวอร์ไม่อนุญาตให้ทำรายการตามข้อมูลนี้', 'โหลดข้อมูลล่าสุดและตรวจรายละเอียดก่อนทำรายการต่อ'],
  };
  const diagnosticCode = `POS_${kind.toUpperCase()}`;
  const outcomeText = outcome === 'unknown'
    ? 'ยังยืนยันไม่ได้ว่ารายการถูกบันทึกหรือไม่ ตรวจประวัติหรือสถานะล่าสุดก่อน ห้ามรับเงินซ้ำหรือสร้างรายการใหม่แทนรายการเดิม'
    : outcome === 'read_failed' ? 'โหลดข้อมูลล่าสุดไม่สำเร็จ ข้อมูลที่เห็นอาจยังไม่อัปเดต' : '';
  return {
    kind, code: diagnosticCode, httpStatus, outcome,
    message: [translate(labels[kind][0]), outcomeText ? translate(outcomeText) : '', translate(labels[kind][1]),
      `[${diagnosticCode}${httpStatus ? ` · HTTP ${httpStatus}` : ''}]`].filter(Boolean).join(' — '),
  };
}

/** Domain errors are already composed by the service (PIN, permission, stock, variants). */
export function isPosBusinessError(code: unknown): boolean {
  return typeof code === 'string' && ['FORBIDDEN', 'BAD_USER_INPUT', 'CONFLICT', 'NOT_FOUND'].includes(code);
}

export function posTransportError(error: unknown, mutation = false,
  translate?: (source: string) => string): Error & { code: string; httpStatus: number | null; statusCode?: number } {
  const failure = describePosConnectionFailure(error, mutation, translate);
  return Object.assign(new Error(failure.message), {
    name: 'PosTransportError', code: failure.code, httpStatus: failure.httpStatus,
    ...(failure.httpStatus ? { statusCode: failure.httpStatus } : {}),
  });
}
