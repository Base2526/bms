"use client";

import { useEffect } from "react";

export default function PosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the original exception available to Electron/Browser DevTools. The POS UI below avoids
    // Next's generic white error page and gives an operator a safe recovery path without mutating
    // the active bill, shift, stock, or payment state.
    console.error("[pos] render failed", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#f5f7fa",
        color: "#182230",
      }}
    >
      <section
        role="alert"
        style={{
          width: "min(560px, 100%)",
          padding: 28,
          border: "1px solid #d9e0e7",
          borderRadius: 18,
          background: "#fff",
          boxShadow: "0 18px 48px rgba(16, 24, 40, 0.12)",
        }}
      >
        <div style={{ fontSize: 34, lineHeight: 1 }} aria-hidden="true">!</div>
        <h1 style={{ margin: "14px 0 6px", fontSize: 24 }}>หน้าจอ POS เปิดไม่สำเร็จ</h1>
        <p style={{ margin: 0, color: "#667085", lineHeight: 1.6 }}>
          ระบบยังไม่ได้ทำรายการขายหรือเปลี่ยนข้อมูล กรุณาลองโหลดหน้าจออีกครั้ง
        </p>
        {process.env.NODE_ENV === "development" ? (
          <pre
            style={{
              margin: "18px 0 0",
              padding: 12,
              overflow: "auto",
              borderRadius: 10,
              background: "#fff4ed",
              color: "#b42318",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {error.message || "Unknown client error"}
            {error.digest ? `\nรหัส: ${error.digest}` : ""}
          </pre>
        ) : null}
        <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{ minHeight: 44, padding: "0 18px", border: 0, borderRadius: 10, background: "#1677ff", color: "#fff", fontWeight: 700 }}
          >
            ลองใหม่
          </button>
          <button
            type="button"
            onClick={() => window.location.assign("/pos")}
            style={{ minHeight: 44, padding: "0 18px", border: "1px solid #d0d5dd", borderRadius: 10, background: "#fff", color: "#344054", fontWeight: 700 }}
          >
            กลับหน้าเริ่ม POS
          </button>
        </div>
      </section>
    </main>
  );
}
