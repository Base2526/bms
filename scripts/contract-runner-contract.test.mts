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
