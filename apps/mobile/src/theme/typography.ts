import { TextStyle } from 'react-native';

// ขนาดตัวหนังสือของจอ POS — เผื่อระยะไว้กว้างกว่าแอปทั่วไปเพราะอ่านจากระยะไกล/แสงจ้าหน้าร้าน
export const typography: Record<string, TextStyle> = {
  displayLg: { fontSize: 32, fontWeight: '700', lineHeight: 40 },
  title: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  subtitle: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  captionStrong: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  numeric: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    fontVariant: ['tabular-nums'],
  },
};
