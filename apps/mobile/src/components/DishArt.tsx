import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

// รูปอาหารบนการ์ดเมนู — พอร์ตมาจาก DISH_ART ของ /pos/restaurant บนเว็บทั้งชุด (รูปทรงเดียวกัน
// คำที่ใช้จับเมนูชุดเดียวกัน) เพื่อให้พนักงานที่ใช้ทั้งสองจอเห็นเมนูเดิมเป็นภาพเดิม
//
// ⚠️ วาดด้วย SVG ในโค้ด ไม่โหลดจาก CDN — ด้วยเหตุผลเดียวกับฝั่งเว็บ: จอขายต้องทำงานตอนเน็ต
// ร้านหลุด · ถ้าสินค้ามีรูปจริง (`imageUrl`) รูปจริงชนะเสมอ

type Glyph = 'RICE' | 'NOODLE' | 'SOUP' | 'SALAD' | 'DRINK';

// ⚠️ ตั้งใจไม่สุ่ม — การ์ดเดิมต้องได้ภาพเดิมทุกครั้งที่เปิดหน้า ไม่งั้นพนักงานจำตำแหน่งไม่ได้
//
// ⚠️ ลำดับต่างจากเว็บโดยตั้งใจ: บนเว็บ DRINK ถูกตรวจเป็นข้อแรก ทำให้คำว่า "น้ำ" ที่อยู่กลางชื่อ
// อาหารชนะกฎอื่นทั้งหมด — "ต้มยำกุ้งน้ำข้น" จึงได้รูปแก้วน้ำ และ "ลาบน้ำตก" ก็เช่นกัน
// (เห็นจริงตอนพอร์ตมาทดสอบบนไอแพด 2026-09-10) · ที่นี่จึงตรวจของคาวก่อนแล้วค่อยตกมาที่เครื่องดื่ม
// เครื่องดื่มจริงไม่มีคำว่า ต้ม/แกง/ตำ/ยำ/เส้น อยู่ในชื่อ จึงไม่มีตัวไหนเสียรูปจากการสลับนี้
// TODO(web): กฎเดียวกันบน /pos/restaurant ยังให้รูปผิดอยู่ — ควรแก้ให้ตรงกันเมื่อแตะไฟล์นั้นครั้งหน้า
const DISH_ART_WORDS: Array<[RegExp, Glyph]> = [
  [/^ข้าว(?!เหนียว)/, 'RICE'],
  [/ต้ม|แกง|ซุป|โจ๊ก|ก๋วยเตี๋ยว/, 'SOUP'],
  [/ตำ|ยำ|สลัด|ลาบ|น้ำตก/, 'SALAD'],
  [/ผัดไทย|ผัดหมี่|เส้น|หมี่|สปาเก็ตตี้|พาสต้า|ราดหน้า/, 'NOODLE'],
  [/ชา|กาแฟ|น้ำ|โอเลี้ยง|โซดา|นม|สมูทตี้|เบียร์|ปั่น/, 'DRINK'],
];

export function glyphForDish(name: string): Glyph {
  for (const [words, key] of DISH_ART_WORDS) if (words.test(name)) return key;
  return 'RICE';
}

function GlyphSvg({
  glyph,
  color,
  size,
}: {
  glyph: Glyph;
  color: string;
  size: number;
}) {
  const common = { width: size, height: size, viewBox: '0 0 100 100' };
  switch (glyph) {
    case 'NOODLE':
      return (
        <Svg {...common}>
          <Ellipse
            cx={50}
            cy={64}
            rx={34}
            ry={15}
            fill={color}
            opacity={0.28}
          />
          <Path d="M19 60c6-17 18-25 31-25s25 8 31 25z" fill={color} />
          <Path
            d="M28 55c8-4 16-4 24 0M32 46c8-4 18-4 26 1M38 39c6-3 14-3 20 1"
            stroke="#fff"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            opacity={0.6}
          />
        </Svg>
      );
    case 'SOUP':
      return (
        <Svg {...common}>
          <Path d="M16 48h68c0 20-15 31-34 31S16 68 16 48z" fill={color} />
          <Ellipse cx={50} cy={48} rx={34} ry={9} fill={color} opacity={0.45} />
          <Circle cx={38} cy={47} r={4.6} fill="#fff" opacity={0.6} />
          <Circle cx={54} cy={45} r={4} fill="#fff" opacity={0.6} />
          <Path
            d="M40 30c0-5 5-6 5-11M58 30c0-5 5-6 5-11"
            stroke={color}
            strokeWidth={3.4}
            fill="none"
            strokeLinecap="round"
            opacity={0.55}
          />
        </Svg>
      );
    case 'SALAD':
      return (
        <Svg {...common}>
          <Ellipse
            cx={50}
            cy={66}
            rx={34}
            ry={14}
            fill={color}
            opacity={0.28}
          />
          <Path d="M23 63c2-15 12-23 27-23s25 8 27 23z" fill={color} />
          <Path
            d="M32 57c6-9 12-12 18-12M45 59c4-10 9-14 15-15"
            stroke="#fff"
            strokeWidth={3.2}
            fill="none"
            strokeLinecap="round"
            opacity={0.6}
          />
        </Svg>
      );
    case 'DRINK':
      return (
        <Svg {...common}>
          <Path
            d="M33 26h34l-4 51a6 6 0 01-6 5H43a6 6 0 01-6-5z"
            fill={color}
            opacity={0.32}
          />
          <Path
            d="M35 43h30l-3 34a5 5 0 01-5 4H43a5 5 0 01-5-4z"
            fill={color}
          />
          <Rect
            x={46}
            y={13}
            width={5}
            height={18}
            rx={2.5}
            fill={color}
            rotation={14}
            originX={48}
            originY={22}
          />
        </Svg>
      );
    case 'RICE':
    default:
      return (
        <Svg {...common}>
          <Ellipse
            cx={50}
            cy={64}
            rx={34}
            ry={15}
            fill={color}
            opacity={0.28}
          />
          <Path d="M20 62c0-13 13-22 30-22s30 9 30 22z" fill={color} />
          <Circle cx={40} cy={50} r={5} fill="#fff" opacity={0.55} />
          <Circle cx={57} cy={47} r={4} fill="#fff" opacity={0.55} />
          <Circle cx={65} cy={55} r={3.2} fill="#fff" opacity={0.55} />
        </Svg>
      );
  }
}

interface Props {
  name: string;
  /** ลำดับสถานีครัว — ใช้วนสีพื้นของช่องรูป (ไม่ผูกกับชื่อสถานี) */
  tintIndex?: number;
  imageUrl?: string | null;
  height?: number;
  /** เมนูที่ขายไม่ได้: พื้นเป็นกลาง + จาง แทน filter: grayscale ของ CSS ที่ RN ไม่มี */
  muted?: boolean;
}

export function DishArt({
  name,
  tintIndex = 0,
  imageUrl,
  height = 96,
  muted,
}: Props) {
  const { colors } = useTheme();
  const tints = colors.menuTints;
  const tint =
    tints[((tintIndex % tints.length) + tints.length) % tints.length];

  return (
    <View
      style={[
        styles.art,
        {
          height,
          backgroundColor: muted ? colors.surface2 : tint.bg,
          opacity: muted ? 0.45 : 1,
        },
      ]}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.photo}
          resizeMode="cover"
        />
      ) : (
        <GlyphSvg
          glyph={glyphForDish(name)}
          color={muted ? colors.textMuted : tint.ink}
          size={Math.round(height * 0.75)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  art: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
});
