import './printerPolyfills';
import { Buffer } from 'buffer';
import { decode } from 'fast-png';
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder';

export const MAX_RECEIPT_HEIGHT = 16000;
export function receiptRaster(base64: string, width: 384 | 576): Uint8Array {
  if (base64.length > 16_000_000) throw new Error('ภาพใบเสร็จใหญ่เกินไป');
  const bytes = Buffer.from(base64, 'base64');
  // Bound allocation before the decoder expands PNG pixels.
  if (
    bytes.length < 33 ||
    bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(16) !== width ||
    bytes.readUInt32BE(20) < 1 ||
    bytes.readUInt32BE(20) > MAX_RECEIPT_HEIGHT
  )
    throw new Error('ขนาดภาพใบเสร็จไม่ถูกต้อง');
  const png = decode(bytes, { checkCrc: true });
  if (
    (png.depth !== 8 && png.depth !== 16) ||
    (png.channels !== 3 && png.channels !== 4)
  ) {
    throw new Error('รูปแบบภาพใบเสร็จไม่รองรับ');
  }
  const maxChannel = png.depth === 16 ? 65535 : 255;
  const encoder = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    imageMode: 'raster',
    feedAfterBlock: false,
  });
  encoder.initialize();
  // Short raster bands avoid printer buffer limits. Thai and QR are captured as pixels, not code pages.
  for (let y = 0; y < png.height; y += 256) {
    const rows = Math.min(256, png.height - y);
    const height = Math.ceil(rows / 8) * 8;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let pixel = 0; pixel < width * rows; pixel++) {
      const from = (y * width + pixel) * png.channels;
      const alpha = png.channels === 4 ? png.data[from + 3] / maxChannel : 1;
      for (let channel = 0; channel < 3; channel++) {
        data[pixel * 4 + channel] = Math.round(
          (png.data[from + channel] / maxChannel) * 255 * alpha +
            255 * (1 - alpha),
        );
      }
    }
    encoder.image(
      { width, height, data },
      { width, height, algorithm: 'threshold', threshold: 180 },
    );
  }
  // Feed only: cutters are optional and opening a cash drawer is a separate permissioned action.
  return encoder.newline(3).encode();
}
