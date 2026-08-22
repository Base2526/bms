// เก็บแยกจาก productImport.ts เพราะไฟล์นี้ไม่แตะ DB — client component (ImportModal) import ตรงได้
// โดยไม่ลาก @/lib/db เข้าไปด้วย
export const PRODUCT_IMPORT_MAX_ROWS = 500;
