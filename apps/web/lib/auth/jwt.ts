import jwt from "jsonwebtoken";
// ความลับตัวเดียวกับ token.ts — เคยประกาศซ้ำที่นี่พร้อม fallback ของตัวเอง
// ทำให้แก้ที่เดียวไม่ครบ · re-export ไว้เพื่อไม่ให้ผู้เรียกเดิมพัง
export { jwtSecret } from "./token";
import { jwtSecret } from "./token";

export function signUserToken(user: any) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    jwtSecret(),
    { expiresIn: "30d" }
  );
}
