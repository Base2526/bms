import { Buffer } from 'buffer';
import { encode } from 'fast-png';
import { receiptRaster } from '../src/lib/receiptRaster';

test.each([384, 576] as const)(
  'encodes %s-dot PNG as bounded black/white ESC/POS raster bands',
  width => {
    const height = 260;
    const data = new Uint8Array(width * height * 4).fill(255);
    data[0] = data[1] = data[2] = 0;
    const last = width * 259 * 4;
    data[last] = data[last + 1] = data[last + 2] = 0;
    const png = encode({ width, height, channels: 4, depth: 8, data });
    const job = receiptRaster(Buffer.from(png).toString('base64'), width);
    const rowStarts: number[] = [];
    for (let i = 0; i < job.length - 8; i++) {
      if (job[i] === 0x1d && job[i + 1] === 0x76 && job[i + 2] === 0x30) {
        const bytes = job[i + 4] + job[i + 5] * 256;
        const rows = job[i + 6] + job[i + 7] * 256;
        expect(bytes).toBe(width / 8);
        expect(rows).toBeLessThanOrEqual(255);
        for (let row = 0; row < rows; row++)
          rowStarts.push(job[i + 8 + row * bytes]);
        i += 7 + bytes * rows;
      }
    }
    expect(rowStarts).toHaveLength(264);
    expect(rowStarts[0]).toBe(128);
    expect(rowStarts[259]).toBe(128);
    expect(rowStarts[260]).toBe(0);
  },
);
test('rejects invalid PNGs or oversized dimensions before decoding', () => {
  expect(() => receiptRaster('not-an-image', 384)).toThrow();
  const header = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(header);
  header.writeUInt32BE(384, 16);
  header.writeUInt32BE(16001, 20);
  expect(() => receiptRaster(header.toString('base64'), 384)).toThrow();
});

test('iOS 16-bit PNG preserves black pixels and flattens transparency', () => {
  const data = new Uint16Array(384 * 8 * 4).fill(65535);
  data[0] = data[1] = data[2] = 0;
  data[4] = data[5] = data[6] = data[7] = 0;
  const png = encode({
    width: 384,
    height: 8,
    channels: 4,
    depth: 16,
    data,
    text: { Source: 'iOS' },
  });
  const job = receiptRaster(Buffer.from(png).toString('base64'), 384);
  const raster = Buffer.from(job).indexOf(Buffer.from([0x1d, 0x76, 0x30]));
  expect(raster).toBeGreaterThanOrEqual(0);
  expect(job[raster + 8]).toBe(128);
});
