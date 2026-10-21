"use client";
import { useMemo } from "react";
import QRCode from "qrcode";

/** LINE's speech-bubble mark; @ant-design/icons has no LINE glyph. */
export function LineIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 3C6.48 3 2 6.6 2 11.03c0 3.97 3.55 7.3 8.35 7.93.32.07.77.21.88.49.1.25.07.65.03.9l-.14.85c-.04.25-.2.98.86.53 1.06-.45 5.73-3.37 7.81-5.77C21.22 14.4 22 12.8 22 11.03 22 6.6 17.52 3 12 3Z" />
    </svg>
  );
}

/**
 * Scannable add-friend QR, drawn as a synchronous SVG (same approach as
 * ReceiptTaxQr). The quiet zone and white plate stay in dark mode on purpose:
 * phone cameras need dark modules on a light background to read the code.
 */
export function LineOaQr({ url, label, size = 88 }: { url: string; label: string; size?: number }) {
  const { side, path } = useMemo(() => {
    const modules = QRCode.create(url, { errorCorrectionLevel: "M" }).modules;
    const parts: string[] = [];
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++)
        if (modules.get(y, x)) parts.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    return { side: modules.size + 8, path: parts.join("") };
  }, [url]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
