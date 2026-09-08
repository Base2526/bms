// เทส pure — **ตั้งใจให้อยู่ในชุดที่ CI รันจริง**
//
// ⚠️ `gate.yml` รันแค่ typecheck + `test:pure` + build · **ชุด DB ไม่มี job ใน CI** (สร้างฐานใหม่จาก
// `db/migrations` ไม่ได้) ดังนั้น `ai-usage-db-contract` ซึ่งเป็นตัวที่พิสูจน์พฤติกรรมจริง
// **ไม่เคยถูกรันอัตโนมัติเลย** · บั๊กที่ทำให้ finalize ล้ม 100% บน BMS-LIVE เป็นการันตีที่สมควรมี
// ด่านในชุดที่รันทุก PR ด้วย ไม่ใช่เฉพาะตอนมีคนนึกได้ว่าต้องรัน `test:db`
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(REPO, 'apps/web');

/** ตัดคอมเมนต์ก่อนสแกนซอร์สเสมอ — คอมเมนต์ที่อธิบายกฎเก่าเคยทำให้ assertion เขียวผิดตัวมาแล้ว
 *  (รอบนี้ผมเจอซ้ำด้วย grep ที่ไปแมตช์คอมเมนต์ที่ตัวเองเพิ่งเขียนอธิบายบั๊ก) */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const read = (file: string) => withoutComments(readFileSync(file, 'utf8'));
const rel = (file: string) => path.relative(REPO, file).split(path.sep).join('/');

test('a bound parameter whose only type source is a bare number must state its type', () => {
  // Postgres resolve ชนิดของพารามิเตอร์จากอีกอาร์กิวเมนต์ของฟังก์ชัน · `COALESCE($3, 0)` จึงได้
  // **integer** จาก literal `0` แล้วค่าที่เป็นทศนิยม throw `invalid input syntax for type integer`
  // ทั้งทรานแซกชัน — นี่คือรูปเป๊ะ ๆ ของบั๊กที่ทำให้ token/cost ของ AI ไม่เคยถูกบันทึกเลย
  //
  // จำกัดที่ literal **ตัวเลข** โดยตั้งใจ: text/boolean ไม่มีความกำกวมแบบ integer↔numeric
  // ส่วนกรณีที่อีกฝั่งเป็น "คอลัมน์" (เช่น `COALESCE($5, estimated_cost)`) infer ถูกอยู่แล้ว
  const pattern = /(COALESCE|GREATEST|LEAST)\(\s*\$(\d+)(::[A-Za-z0-9_]+(?:\[\])?)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g;
  const offenders: string[] = [];
  for (const file of walk(path.join(WEB, 'lib'))) {
    for (const match of read(file).matchAll(pattern)) {
      if (!match[3]) offenders.push(`${rel(file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `พารามิเตอร์เหล่านี้ติดกับ literal ตัวเลขโดยไม่ระบุชนิด — เติม cast (เช่น $n::numeric / $n::int)\n${offenders.join('\n')}`
  );
});

test('the AI monthly cost update casts its cost parameter to numeric', () => {
  // ด่านตัวข้างบนเป็นกฎกว้าง · ตัวนี้เรียกชื่อบั๊กตรง ๆ เพื่อให้ตอนแดงอ่านรู้เรื่องว่าคืออะไร
  const src = read(path.join(WEB, 'lib/bms/aiUsage.ts'));
  assert.match(
    src,
    /estimated_cost = estimated_cost \+ COALESCE\(\$3::numeric, 0\)/,
    'ยอดต้นทุนรายเดือนต้องรับพารามิเตอร์เป็น numeric ไม่ใช่ integer'
  );
});

test('the stale sweep decides refunds from the computed id set, not from provider_calls alone', () => {
  // `provider_calls = 0` มีสองความหมาย: abort ก่อนถึง provider (คืน credit ถูก) กับเรียกไปแล้วแต่
  // บันทึกไม่ลง (**คืน = แจกโควตาฟรีให้ค่าใช้ที่เกิดจริง**) · ตัวแถวเองแยกไม่ออก ต้องดู incident
  const src = read(path.join(WEB, 'lib/bms/aiUsage.ts'));
  const start = src.indexOf('async function reconcileStaleAiReservations');
  const end = src.indexOf('export async function getAiUsage');
  assert.ok(start > 0 && end > start, 'ไม่พบช่วงของตัวกวาด reservation — เล็งเทสใหม่');
  const sweep = src.slice(start, end);
  assert.match(sweep, /billable_credits = CASE WHEN id = ANY\(\$2::uuid\[\]\)/);
  assert.doesNotMatch(
    sweep,
    /billable_credits = CASE WHEN provider_calls = 0/,
    'การคืน credit ต้องตัดสินจากชุด id ที่คำนวณแล้ว ไม่ใช่ provider_calls ตรง ๆ ใน SQL'
  );
  assert.match(sweep, /ai\.provider_attempt_unrecorded/, 'ตัวกวาดต้องอ่าน incident เพื่อแยกสองกรณี');
});

test('both AI accounting failures are reported, and their codes exist in the catalog', () => {
  // `reportBmsFailure` เริ่มด้วย `if (!entry) return;` — code ที่ไม่มีใน FAILURE_CATALOG
  // จะถูกทิ้งเงียบ ๆ ซึ่งเท่ากับกลับไปเป็น console.error เหมือนเดิม
  const usage = read(path.join(WEB, 'lib/bms/aiUsage.ts'));
  const catalog = read(path.join(WEB, 'lib/bms/failureAlert.ts'));
  for (const code of ['ai.usage_finalize_failed', 'ai.provider_attempt_unrecorded']) {
    assert.ok(usage.includes(`"${code}"`), `aiUsage ต้องรายงาน ${code}`);
    assert.ok(catalog.includes(`"${code}":`), `${code} ต้องมี entry ใน FAILURE_CATALOG`);
  }
});

test('the production consistency check stays read-only', () => {
  // ไฟล์นี้ถูกเขียนมาให้รันกับ **ฐาน production** ด้วย psql (เซิร์ฟเวอร์ไม่มี Node)
  // คำสั่งเขียนแม้บรรทัดเดียวเปลี่ยนมันจากเครื่องมือตรวจเป็นความเสี่ยง
  const sql = readFileSync(path.join(REPO, 'db/checks/ai-usage-consistency.sql'), 'utf8');
  // ตัดทั้งคอมเมนต์และบรรทัด \echo — รอบแรกเทสนี้แดงผิดตัวสองครั้ง: คำว่า "insert" ในข้อความไทย
  // ของ \echo และ `CREATE` ที่ไปแมตช์ **substring ของ `created_at`** · ต้องเล็งด้วย word boundary
  // และคำที่ตามมาจริง ไม่ใช่ substring เปล่า ๆ
  const stripped = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--') && !line.trim().startsWith('\\echo'))
    .join('\n');
  const writes =
    /\b(INSERT\s+INTO|UPDATE\s+[A-Za-z_"]|DELETE\s+FROM|DROP\s+[A-Za-z]|ALTER\s+[A-Za-z]|TRUNCATE\b|GRANT\s+[A-Za-z]|REVOKE\s+[A-Za-z]|CREATE\s+[A-Za-z])/i;
  const hit = stripped.match(writes);
  assert.equal(hit, null, `ตัวตรวจต้องไม่มีคำสั่งเขียน แต่พบ: ${hit?.[0] ?? ''}`);
  assert.match(sql, /อ่านอย่างเดียว/, 'หัวไฟล์ต้องประกาศตัวเองว่าอ่านอย่างเดียว');
});

test('a nullable token count is never rendered as zero', () => {
  // `0 in · 0 out` อ่านเหมือน "เรียกแล้วไม่ใช้โทเคน" ซึ่งเป็นไปไม่ได้ · การโกหกที่อ่านไม่ออกว่าโกหก
  // คือเหตุที่บั๊ก finalize อยู่มาได้เป็นเดือนโดยไม่มีใครสังเกต
  //
  // ยกเว้นยอดรวมรายเดือน (`aiUsage.*`) เพราะ schema ประกาศเป็น non-null: 0 ที่นั่นแปลว่า
  // "เดือนนี้ยังไม่ได้ใช้" จริง ไม่ใช่ "ไม่รู้" · ข้อยกเว้นนี้ตรวจตัวเองได้ด้วย assert ข้างล่าง
  // ถ้าวันไหนมีคนทำให้ฟิลด์นั้น nullable ข้อยกเว้นจะหมดเหตุผลและเทสจะแดงให้เห็น
  assert.match(
    read(path.join(WEB, 'graphql/typeDefs.ts')),
    /inputTokens: Float!\s*\n\s*outputTokens: Float!/,
    'ยอดโทเคนรายเดือนต้องเป็น non-null ไม่งั้นข้อยกเว้นด้านล่างใช้ไม่ได้'
  );
  const offenders: string[] = [];
  for (const file of walk(path.join(WEB, 'app'))) {
    const src = read(file);
    for (const match of src.matchAll(/([A-Za-z0-9_?.]*)\b(input|output)Tokens\s*\?\?\s*0/gi)) {
      if (/^aiUsage\??\.$/.test(match[1])) continue;
      offenders.push(`${rel(file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `ค่าโทเคนที่ไม่รู้ต้องแสดงว่าไม่รู้\n${offenders.join('\n')}`);
});
