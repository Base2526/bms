"use client";
import { useMemo } from "react";
import QRCode from "qrcode";
/** Synchronous SVG avoids racing an async image when printing immediately. */
export default function ReceiptTaxQr({
  url,
  label,
}: {
  url: string;
  label: string;
}) {
  const matrix = useMemo(
    () => QRCode.create(url, { errorCorrectionLevel: "M" }).modules,
    [url]
  );
  const size = matrix.size,
    paths: string[] = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (matrix.get(y, x)) paths.push(`M${x + 4} ${y + 4}h1v1h-1z`);
  return (
    <div style={{ textAlign: "center", marginTop: 12 }}>
      <div>{label}</div>
      <svg
        role="img"
        aria-label={label}
        width="150"
        height="150"
        viewBox={`0 0 ${size + 8} ${size + 8}`}
        shapeRendering="crispEdges"
      >
        <rect width="100%" height="100%" fill="white" />
        <path d={paths.join("")} fill="black" />
      </svg>
    </div>
  );
}
