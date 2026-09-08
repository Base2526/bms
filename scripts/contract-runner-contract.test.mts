// ตัวรันชุดเทสเองก็ต้องมีเทส — ความล้มเหลวที่เงียบที่สุดของ repo นี้คือ "รัน 0 ไฟล์แล้วเขียว"
//
// ⚠️ ตอน mutation test ไฟล์นี้: **ห้ามใส่ mutation ที่ทำให้ตัวกรองตกกลับไปรันทั้งชุด**
// (เช่น filter ไม่ตรงแล้ว fall back เป็น inMode) เพราะเทสในไฟล์นี้เรียกตัวรันซ้อน ผลคือ
// รอบซ้อนจะหยิบไฟล์นี้มารันอีกที = recursion จนหมดเวลา · mutation ที่ตรงกับการันตีข้อนั้น
// คือ "ทางที่ไม่ตรงเขียนไฟล์สรุปทิ้งไว้" ซึ่งยัง exit 2 เหมือนเดิม
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { summarizeTapFailures } from './testing/tapFailures.mjs';

const SCRIPTS = path.resolve(import.meta.dirname);
const RUNNER = path.join(SCRIPTS, 'run-contract-tests.mjs');
/**
 * ไม่ส่ง POSTGRES_* ต่อ เพื่อให้เคสที่ตรวจ host เห็น env ที่เราตั้งเท่านั้น
 *
 * และต้องตัด NODE_TEST_CONTEXT / NODE_OPTIONS ออกด้วย: node ตั้ง NODE_TEST_CONTEXT ให้ทุก
 * child ของ test runner ถ้าปล่อยให้สืบทอดเข้าไปในรอบซ้อน ตัวรันข้างในจะคิดว่าตัวเองเป็นลูก
 * ของ runner อีกตัวแล้ว **เปลี่ยนรูปแบบ output ทิ้ง reporter destination ไปเงียบ ๆ** —
 * อาการคือไฟล์ .tap ไม่ถูกสร้างเลยทั้งที่ exit code เป็น 0 (เจอตอนเขียนเทสนี้)
 */
const run = (args: string[], env: Record<string, string> = {}) => {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !key.startsWith('POSTGRES_') && key !== 'NODE_TEST_CONTEXT' && key !== 'NODE_OPTIONS')
  ) as Record<string, string>;
  return spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8', env: { ...clean, ...env },
  });
};

/**
 * ทุกเคสที่รันจริงต้องเขียนผลไปโฟลเดอร์ชั่วคราว ห้ามใช้ `.test-output/` ของจริง
 *
 * ไฟล์นี้ถูกรันโดยตัวรันตัวเดียวกันนั้น — ถ้าลูกเขียนทับ `.test-output/pure.tap` ที่แม่
 * เปิดค้างไว้ ผลของรอบจริงจะเสียกลางทางโดยไม่มีอะไรฟ้อง
 */
const withOutputDir = <T>(fn: (dir: string) => T): T => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bms-gate-out-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const runFile = (dir: string, mode: string) => readFileSync(path.join(dir, mode + '.run.txt'), 'utf8');

test('a filter that matches nothing fails loudly instead of reporting a green run of zero files', () => {
  // ทางเดิมของ "รันไฟล์เดียว" คือ npx tsx --test <ไฟล์> ซึ่งข้ามด่านตรวจ host ทั้งหมด
  // ตัวกรองจึงมีไว้ให้ไม่ต้องเลี่ยง — แต่ถ้ามันตอบ 0 ไฟล์แบบ exit 0 คนจะอ่านว่าเทสผ่าน
  const missed = run(['pure', 'no-such-suite-name']);
  assert.equal(missed.status, 2);
  assert.match(missed.stderr, /ไม่ตรงไฟล์ไหนในโหมด pure/);
  assert.doesNotMatch(missed.stdout, /# fail 0/);
  // และต้องช่วยให้พิมพ์ถูกในครั้งถัดไป ไม่ใช่บอกแค่ว่าไม่เจอ
  assert.match(missed.stderr, /ตัวอย่างชื่อที่มี:/);
});

test('an unknown mode is refused before anything runs', () => {
  const bad = run(['nope']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /ใช้ pure \| db \| all/);
});

test('the DB suite is refused on a host that is not this machine, filtered or not', () => {
  // ชุด DB เขียนจริงลงฐาน และ 34 จาก 35 ไฟล์ไม่มีด่านของตัวเอง — ด่านนี้จึงเป็นด่านเดียว
  for (const args of [['db'], ['db', 'restaurant-request'], ['all']]) {
    const remote = run(args, { POSTGRES_HOST: 'db.example.com', POSTGRES_DB: 'bms' });
    assert.equal(remote.status, 2, args.join(' '));
    assert.match(remote.stderr, /ห้ามรันกับ production/);
  }
  // ไม่ตั้ง env เลยก็ต้องไม่รัน (เดา localhost ให้ไม่ได้ — ฐานไหนก็ไม่รู้)
  const noEnv = run(['db']);
  assert.equal(noEnv.status, 2);
  assert.match(noEnv.stderr, /POSTGRES_HOST \+ POSTGRES_DB/);
});

test('every test file lands in exactly one mode, and ai-eval is inside one of them', () => {
  // ชื่อไฟล์คือสัญญา: -db-contract = ต้องมี Postgres · ที่เหลือรันที่ไหนก็ได้
  // ไฟล์ที่ตกทั้งสองโหมดคือไฟล์ที่ไม่มีใครรัน ซึ่งเคยเกิดจริงกับทั้งโฟลเดอร์ ai-eval
  //
  // อ่านจำนวนจาก **ตัวรันเอง** ผ่านตัวกรองที่ไม่ตรงอะไร (มันบอก "(N ไฟล์)" แล้วออกก่อนรัน
  // อะไรทั้งนั้น) — เดินไดเรกทอรีเองในเทสแล้วเทียบกับตัวเอง คือเทสที่เขียวแม้ตัวรันจะเลิกเดิน
  // เข้า ai-eval ไปแล้ว (เจอตอน mutation test รอบนี้)
  const seen = (mode: string) => {
    const out = run([mode, 'no-such-suite-name']);
    assert.equal(out.status, 2, mode);
    const count = /\((\d+) ไฟล์\)/.exec(out.stderr);
    assert.ok(count, `ตัวรันโหมด ${mode} ไม่ได้บอกจำนวนไฟล์: ${out.stderr}`);
    return { count: Number(count![1]), examples: out.stderr };
  };
  const pure = seen('pure');
  const db = seen('db');
  const all = seen('all');
  assert.equal(pure.count + db.count, all.count);
  assert.ok(pure.count > 50 && db.count > 20, `${pure.count} + ${db.count}`);
  // ชุด ai-eval ต้องอยู่ในโหมด pure จริง ไม่ใช่แค่มีไฟล์อยู่บนดิสก์
  assert.match(pure.examples, /ai-eval\//);
  // และจำนวนที่ตัวรันเห็นต้องตรงกับไฟล์ที่มีอยู่จริง
  const collect = (dir: string, prefix = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === 'ai-eval' ? collect(path.join(dir, entry.name), `${entry.name}/`) : []
        : entry.name.endsWith('.test.mts') ? [`${prefix}${entry.name}`] : []
    );
  assert.equal(all.count, collect(SCRIPTS).length);
});

test('a finished run leaves a file that says what ran, against which database, and how it ended', () => {
  withOutputDir((dir) => {
    const ok = run(['pure', 'migration-order-contract'], { BMS_TEST_OUTPUT_DIR: dir });
    assert.equal(ok.status, 0, ok.stderr);
    const summary = runFile(dir, 'pure');
    // สิ่งที่ TAP ตอบแทนไม่ได้: รันโหมดไหน กี่ไฟล์ ไฟล์อะไร คอมมิตไหน ฐานไหน
    assert.match(summary, /^mode=pure$/m);
    assert.match(summary, /^files=1$/m);
    assert.match(summary, /^filter=migration-order-contract$/m);
    assert.match(summary, /^commit=\w+$/m);
    assert.match(summary, /^database=-$/m);
    assert.match(summary, /migration-order-contract\.test\.mts$/m);
    // บรรทัดปิดท้ายคือตัวแยก "รันจบ" ออกจาก "ตายกลางทาง" — ไฟล์ที่ไม่มี exit= ห้ามอ่านว่าเขียว
    assert.match(summary, /^exit=0$/m);
    // ผลเต็มต้องเป็น TAP ที่ grep/diff ได้
    const tap = readFileSync(path.join(dir, 'pure.tap'), 'utf8');
    assert.match(tap, /^TAP version 13$/m);
    assert.match(tap, /^ok 1 - /m);
    // จอยังต้องขยับตลอดรอบ (pure ใช้ราว 30 วิ) ไม่ใช่เงียบแล้วให้ไปเปิดไฟล์เอง
    assert.match(ok.stdout, /pass 3/);
    // รอบที่เขียวก็ต้องเขียนไฟล์สรุปทับ — ไฟล์ของรอบก่อนที่ค้างอยู่คือสิ่งที่จะถูกก็อปส่งต่อ
    // โดยไม่มีใครรู้ว่าเป็นของรอบไหน (ไฟล์นี้มีไว้ให้แปะ จึงต้องเป็นของรอบล่าสุดเสมอ)
    const digest = readFileSync(path.join(dir, 'pure.failures.txt'), 'utf8');
    assert.match(digest, /✅ ไม่มีเทสที่แดงในรอบนี้/);
    assert.match(digest, /^exit=0$/m);
  });
});

test('the recorded exit code is the real one, and the database is named for a DB run', () => {
  withOutputDir((dir) => {
    // พอร์ต 1 ต่อไม่ได้แน่นอน และ 127.0.0.1 ผ่านด่าน host — ได้รอบที่รันแล้วแดงโดยไม่แตะฐานใคร
    const failed = run(['db', 'db-role-grants'], {
      BMS_TEST_OUTPUT_DIR: dir, POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '1', POSTGRES_DB: 'bms',
    });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    const summary = runFile(dir, 'db');
    assert.match(summary, /^database=127\.0\.0\.1\/bms$/m);
    // exit= มาจากผลจริงของลูก ไม่ใช่ค่าคงที่ และเขียนหลังลูกจบเท่านั้น
    assert.match(summary, /^exit=1$/m);
    assert.match(summary, /^duration_ms=\d+$/m);
  });
});

test('a run that never started leaves no summary to mistake for a green one', () => {
  withOutputDir((dir) => {
    // ตัวกรองไม่ตรง = ไม่มีอะไรรัน จึงต้องไม่มีไฟล์สรุปของรอบนี้เลย
    assert.equal(run(['pure', 'no-such-suite-name'], { BMS_TEST_OUTPUT_DIR: dir }).status, 2);
    assert.deepEqual(readdirSync(dir), []);
  });
});

test('the output directory is not committed', () => {
  const ignored = spawnSync('git', ['check-ignore', '.test-output/pure.tap'], {
    cwd: path.resolve(SCRIPTS, '..'), encoding: 'utf8',
  });
  assert.equal(ignored.status, 0, 'ต้องอยู่ใน .gitignore — 249 KB ต่อรอบ และเป็นของเครื่องนั้น');
});

// =============================================================
// ไฟล์สรุป "เฉพาะที่แดง" — ของที่เอาไปแปะให้คน/AI อ่านต่อได้จริง
// -------------------------------------------------------------
// TAP เต็มคือ 263 KB ตอนเขียว และ **หนึ่ง** assertion ที่แดงกินได้ 28 KB เพราะ assert.match
// ที่ล้มพิมพ์ทั้งไฟล์ต้นฉบับลงในบล็อก error · ไฟล์นี้จึงต้องเล็กและต้องไม่โกหกว่าเขียว
// =============================================================

const tapOf = (body: string) => `TAP version 13
${body}
1..1
# tests 1
# suites 0
# pass 0
# fail 1
`;

const failureBlock = (name: string, error: string) => `# Subtest: ${name}
not ok 1 - ${name}
  ---
  duration_ms: 1
  type: 'test'
  location: 'C:\\Users\\someone\\bms\\scripts\\demo-contract.test.mts:1:77290'
  failureType: 'testCodeFailure'
  error: |-
${error.split('\n').map((line) => `    ${line}`).join('\n')}
  code: 'ERR_ASSERTION'
  operator: 'match'
  stack: |-
    TestContext.<anonymous> (C:\\Users\\someone\\bms\\scripts\\demo-contract.test.mts:1284:10)
  ...`;

test('ไฟล์สรุปตัดข้อความยาวลง แต่บอกทางไปดูของเต็ม', () => {
  const huge = Array.from({ length: 500 }, (_, i) => `source line ${i}`).join('\n');
  const out = summarizeTapFailures(tapOf(failureBlock('เทสตัวอย่าง', huge)), {
    exit: 1, tap: '.test-output/pure.tap',
  });
  assert.match(out, /พบ 1 เทสที่แดง/);
  assert.match(out, /เทสตัวอย่าง/);
  assert.match(out, /source line 0/);
  // ต้องไม่ลากทั้ง 500 บรรทัดมา ไม่งั้นก็อปส่งต่อไม่ได้ ซึ่งเป็นเหตุผลที่ไฟล์นี้มีอยู่
  assert.doesNotMatch(out, /source line 400/);
  assert.match(out, /… ตัดออก \d+ บรรทัด — ของเต็มที่ \.test-output\/pure\.tap บรรทัด \d+/);
  assert.ok(out.length < 4000, `สรุปต้องเล็กพอจะแปะ แต่ได้ ${out.length} ไบต์`);
});

test('ที่อยู่ของตัวที่แดงต้องเป็นพาธจากรากรีโป ไม่ใช่พาธของเครื่องใคร', () => {
  const out = summarizeTapFailures(tapOf(failureBlock('เทสตัวอย่าง', 'พัง')), { exit: 1 });
  // stack ชี้บรรทัดจริง ส่วน location ของ tsx เป็น offset ของไฟล์ที่ bundle แล้ว (1:77290)
  assert.match(out, /ที่: scripts\/demo-contract\.test\.mts:1284/);
  assert.doesNotMatch(out, /someone/, 'ชื่อผู้ใช้ต้องไม่ติดไปกับผลที่ส่งต่อ');
  assert.doesNotMatch(out, /:77290/);
});

test('รอบที่เขียวต้องเขียนทับด้วยคำว่าไม่มีตัวแดง ไม่ใช่ปล่อยไฟล์รอบก่อนค้าง', () => {
  const green = summarizeTapFailures(`TAP version 13
ok 1 - อะไรสักอย่าง
1..1
# tests 1
# pass 1
# fail 0
`, { exit: 0 });
  assert.match(green, /✅ ไม่มีเทสที่แดงในรอบนี้/);
  assert.match(green, /tests=1 pass=1 fail=0/);
  assert.doesNotMatch(green, /พบ \d+ เทสที่แดง/);
});

test('รอบที่ตายกลางทางต้องอ่านไม่ได้ว่าเขียว', () => {
  // process ที่ถูกฆ่าทิ้ง TAP ครึ่งเดียวที่ไม่มี not ok และไม่มีแผน 1..N อยู่ในนั้นเลย
  const half = 'TAP version 13\nok 1 - เทสแรก\n';
  // ต้องไม่เขียวทั้งสองทาง — exit=0 คือเคสที่หลอกกว่า (เชลล์รายงาน 0 ทั้งที่ลูกถูกฆ่า)
  for (const exit of [1, 0]) {
    const killed = summarizeTapFailures(half, { exit });
    assert.match(killed, /ยังไม่จบ/, `exit=${exit}`);
    assert.doesNotMatch(killed, /✅/, `exit=${exit}`);
  }
});

test('exit ไม่ใช่ 0 แต่ไม่มีตัวแดงใน TAP = ไฟล์เทสโหลดไม่ขึ้น ต้องบอกให้ไปดูที่จอ', () => {
  const broken = summarizeTapFailures('TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n', { exit: 1 });
  assert.match(broken, /โหลดไม่ขึ้น/);
  assert.doesNotMatch(broken, /✅/);
});

test('ตัวแดงเป็นร้อยต้องไม่กลายเป็นไฟล์ที่แปะไม่ได้', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    `not ok ${i + 1} - เทสที่ ${i + 1}`).join('\n');
  const out = summarizeTapFailures(`TAP version 13\n${many}\n1..60\n# tests 60\n# pass 0\n# fail 60\n`, { exit: 1 });
  assert.match(out, /พบ 60 เทสที่แดง/);
  assert.match(out, /อีก 40 ตัวที่แดง \(ชื่ออย่างเดียว\)/);
  // ชื่อของทุกตัวยังต้องอยู่ครบ — คนอ่านต้องรู้ว่าอะไรแดงบ้าง แม้จะไม่ได้รายละเอียด
  assert.match(out, /- เทสที่ 60/);
});

test('รอบที่แดงจริงเขียนไฟล์ที่เล็กกว่า TAP มากและชี้ตัวที่แดงได้', () => {
  withOutputDir((dir) => {
    // พอร์ต 1 ต่อไม่ได้แน่นอน = ได้รอบที่แดงจริงโดยไม่แตะฐานของใคร (เหมือนเคส exit code ข้างบน)
    const failed = run(['db', 'db-role-grants'], {
      BMS_TEST_OUTPUT_DIR: dir, POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: '1', POSTGRES_DB: 'bms',
    });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    const digest = readFileSync(path.join(dir, 'db.failures.txt'), 'utf8');
    const tap = readFileSync(path.join(dir, 'db.tap'), 'utf8');
    assert.ok(digest.length < tap.length, 'สรุปต้องเล็กกว่า TAP');
    assert.match(digest, /^mode=db$/m);
    assert.match(digest, /^database=127\.0\.0\.1\/bms$/m);
    assert.match(digest, /^exit=1$/m);
    assert.match(digest, /พบ \d+ เทสที่แดง/);
    assert.match(digest, /ที่: scripts\/db-role-grants-db-contract\.test\.mts/);
    // จอต้องบอกด้วยว่าไฟล์นี้อยู่ไหน ไม่งั้นไม่มีใครรู้ว่ามีให้ก็อป
    assert.match(failed.stdout, /failures\.txt/);
  });
});
