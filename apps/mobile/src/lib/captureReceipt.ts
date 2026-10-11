import type React from 'react';
import {
  PixelRatio,
  Platform,
  type View,
  type LayoutRectangle,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { MAX_RECEIPT_HEIGHT, receiptRaster } from './receiptRaster';
import type { PrinterConfig } from './networkPrinter';

export async function captureReceipt(
  ref: React.RefObject<React.ComponentRef<typeof View> | null>,
  layout: Pick<LayoutRectangle, 'width' | 'height'> | null,
  config: PrinterConfig,
) {
  if (!ref.current || !layout?.width || !layout.height)
    throw new Error('ใบเสร็จยังไม่พร้อมพิมพ์');
  const width = config.paperWidth === 58 ? 384 : 576;
  const height = Math.ceil((layout.height * width) / layout.width);
  if (height > MAX_RECEIPT_HEIGHT)
    throw new Error('ใบเสร็จยาวเกินขนาดที่รองรับ');
  // View-shot's iOS renderer uses points at device scale; Android's target is already pixels.
  const scale = Platform.OS === 'ios' ? PixelRatio.get() : 1;
  const png = await captureRef(ref, {
    format: 'png',
    result: 'base64',
    width: width / scale,
    height: height / scale,
  });
  return receiptRaster(png, width);
}
