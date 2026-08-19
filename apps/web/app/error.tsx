"use client";

// =============================================================
// Error boundary ระดับหน้า — เดิมไม่มีเลย
// -------------------------------------------------------------
// component ที่ throw ตอน render ทำให้ Next แสดงหน้า error กลางของตัวเอง แล้ว
// ไม่มีใครรู้ว่าเกิดอะไรกับใคร (error ฝั่ง browser ไม่ผ่าน route handler จึงไม่มี
// อะไรเขียนลง system_logs) · ตรงนี้ยิงเข้า /api/logs ให้ก่อนแสดงผล
// =============================================================

import { useEffect } from "react";
import { addLog } from "@/lib/log/log";

export default function GlobalPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void addLog("error", "ui", `render error: ${error.message}`, {
      action: "ui.render_error",
      // digest คือรหัสที่ Next ใช้ผูกกับ error จริงฝั่ง server (production ซ่อน
      // ข้อความจริงไว้) — ต้องเก็บไว้ ไม่งั้นจับคู่กับ log ฝั่ง server ไม่ได้
      digest: error.digest ?? null,
      errorMessage: error.message,
      stack: error.stack ?? null,
      routeName: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [error]);

  return (
    <div style={{ padding: 32, fontFamily: "inherit" }}>
      <h2 style={{ marginBottom: 8 }}>หน้านี้ทำงานผิดพลาด</h2>
      <p style={{ marginBottom: 16, color: "#666" }}>
        ระบบบันทึกข้อผิดพลาดไว้แล้ว{error.digest ? ` (รหัสอ้างอิง ${error.digest})` : ""} — ลองใหม่อีกครั้ง
        ถ้ายังไม่หายให้แจ้งทีมงานพร้อมรหัสอ้างอิงนี้
      </p>
      <button
        onClick={reset}
        style={{
          padding: "8px 16px",
          borderRadius: 6,
          border: "1px solid #1677ff",
          background: "#1677ff",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        ลองใหม่
      </button>
    </div>
  );
}
