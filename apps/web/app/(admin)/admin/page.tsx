import { redirect } from "next/navigation";

// หน้าแรก admin = BMS Dashboard
// (เดิมเป็น dashboard ของ project เก่า posts/files/users — เลิกใช้แล้ว, โค้ดเดิมอยู่ใน git history)
export default function AdminHome() {
  redirect("/admin/dashboard");
}
