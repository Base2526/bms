// =============================================================
// สรุป "เฉพาะเทสที่แดง" จากไฟล์ TAP ให้เล็กพอจะก็อปไปให้คนหรือ AI อ่านต่อ
// -------------------------------------------------------------
// ไฟล์ TAP เต็มของรอบที่ผ่านคือ ~263 KB และ **หนึ่ง** assertion ที่แดงกินได้ถึง 576 บรรทัด /
// 28 KB เพราะ `assert.match()` ที่ล้มจะพิมพ์ทั้งไฟล์ต้นฉบับลงในบล็อก `error:` · คนที่จะเอา
// ผลไปให้ AI วิเคราะห์ต่อจึงต้อง grep เองทุกครั้ง แล้วก็ยังได้ก้อนที่แปะไม่ไหวอยู่ดี
//
// ไฟล์นี้จึงตัดเหลือ: หัวรอบ (commit/ฐาน/exit) + ตัวที่แดงพร้อมที่อยู่ในซอร์ส + ข้อความ error
// ที่ถูกตัดความยาว พร้อมบอกว่าไปดูของเต็มได้ที่บรรทัดไหนของ TAP
//
// **ตั้งใจไม่ใช้ YAML parser** — บล็อกของ node เป็น subset ที่แน่นอน (scalar บรรทัดเดียว
// กับ block scalar `|-`) การลง dependency เพื่ออ่านสองรูปนี้แพงกว่าที่ได้
// =============================================================

/** จำนวนบรรทัดของ error ที่เก็บไว้ต่อหนึ่งเทส — พอเห็นสาเหตุโดยไม่ลากทั้งไฟล์มาด้วย */
const ERROR_LINE_BUDGET = 40;
/** expected/actual สั้นกว่า เพราะของยาว ๆ มักซ้ำกับ error อยู่แล้ว */
const VALUE_LINE_BUDGET = 8;
/** รายละเอียดเต็มกี่ตัว ที่เหลือลิสต์แค่ชื่อ — 200 ตัวแดงต้องไม่กลายเป็นไฟล์ 200 KB */
const DETAILED_FAILURE_BUDGET = 20;

const NL = String.fromCharCode(10);
const RULE = "────────────────────────────────────────────────────────";

/** ตัดพาธเต็มของเครื่องออก เหลือพาธจากรากรีโป — ผลที่ส่งต่อไม่ควรมีชื่อผู้ใช้ติดไป */
export function relativeTestPath(value) {
  const match = /(?:^|[\\/])(scripts[\\/][^\s)'"]+?\.test\.mts)(?::(\d+))?/.exec(value ?? "");
  if (!match) return null;
  const file = match[1].split("\\").join("/");
  return match[2] ? `${file}:${match[2]}` : file;
}

/**
 * แกะบล็อก YAML ของเทสหนึ่งตัว
 *
 * รูปที่ node ออก: บรรทัด `---` แล้ว `key: value` หรือ `key: |-` ตามด้วยเนื้อที่ย่อหน้าลึกกว่า
 * จบที่ `...` ที่ระดับเดียวกับ `---`
 */
function parseBlock(lines, from, indent) {
  const pad = " ".repeat(indent);
  const fields = {};
  let i = from;
  while (i < lines.length) {
    if (lines[i] === `${pad}...`) return { fields, end: i };
    const simple = new RegExp(`^${pad}([A-Za-z_][A-Za-z0-9_]*): (.*)$`).exec(lines[i]);
    if (simple) {
      if (simple[2] === "|-" || simple[2] === "|") {
        const body = [];
        i += 1;
        while (i < lines.length) {
          const next = lines[i];
          if (next === `${pad}...`) break;
          // บรรทัดที่ลึกกว่า = เนื้อของ block scalar · บรรทัดว่างก็เป็นเนื้อได้
          if (next.trim() !== "" && !next.startsWith(`${pad}  `)) break;
          body.push(next.slice(indent + 2));
          i += 1;
        }
        fields[simple[1]] = body.join(NL);
        continue;
      }
      fields[simple[1]] = simple[2].replace(/^'(.*)'$/, "$1");
    }
    i += 1;
  }
  return { fields, end: i };
}

export function parseTapFailures(tap) {
  const lines = String(tap ?? "").split(/\r?\n/);
  const failures = [];
  const counts = {};
  let plan = false;
  for (let i = 0; i < lines.length; i += 1) {
    const summary = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(lines[i]);
    if (summary) counts[summary[1]] = Number(summary[2]);
    if (/^1\.\.\d+$/.test(lines[i])) plan = true;
    const failed = /^(\s*)not ok \d+ - (.*)$/.exec(lines[i]);
    if (!failed) continue;
    const indent = failed[1].length;
    const entry = { name: failed[2].trim(), tapLine: i + 1, fields: {} };
    if (lines[i + 1] === `${" ".repeat(indent)}  ---`) {
      entry.fields = parseBlock(lines, i + 2, indent + 2).fields;
    }
    failures.push(entry);
  }
  return { failures, counts, plan };
}

/** พิมพ์ค่าหลายบรรทัดแบบมีเพดาน พร้อมบอกว่าตัดไปเท่าไรและไปดูของเต็มได้ที่ไหน */
function budgeted(label, value, budget, tapRef) {
  const body = String(value ?? "").split(NL);
  if (!value || (body.length === 1 && body[0] === "")) return [];
  const out = [`${label}:`, ...body.slice(0, budget).map((line) => `  ${line}`)];
  if (body.length > budget) out.push(`  … ตัดออก ${body.length - budget} บรรทัด — ของเต็มที่ ${tapRef}`);
  return out;
}

/**
 * @param {string} tap   เนื้อไฟล์ TAP
 * @param {object} meta  หัวรอบจากตัวรัน (mode/commit/exit/…)
 * @returns {string}     ข้อความพร้อมก็อป
 */
export function summarizeTapFailures(tap, meta = {}) {
  const { failures, counts, plan } = parseTapFailures(tap);
  const head = [
    "# BMS contract tests — สรุปเฉพาะที่แดง",
    ...Object.entries(meta)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}=${value}`),
    `tests=${counts.tests ?? "?"} pass=${counts.pass ?? "?"} fail=${counts.fail ?? "?"}`,
  ];

  // "ไม่มี not ok" ไม่ได้แปลว่าเขียวเสมอ — process ที่ถูกฆ่ากลางทางทิ้ง TAP ครึ่งเดียวที่ไม่มี
  // not ok อยู่ในนั้นเลย ซึ่งอ่านเหมือนผ่าน · แผน `1..N` กับ exit code เป็นตัวแยกสองกรณีนี้
  const exit = Number(meta.exit ?? 0);
  if (!plan) {
    head.push("", "⚠️ TAP ไม่มีบรรทัดแผน `1..N` = รอบนี้ยังไม่จบ (ถูกฆ่า/ค้าง) ห้ามอ่านว่าเขียว");
  }
  if (failures.length === 0) {
    if (exit !== 0) {
      head.push(
        "",
        `⚠️ ไม่พบเทสที่แดงใน TAP แต่ exit=${exit} — มักแปลว่าไฟล์เทสโหลดไม่ขึ้น (syntax/import)`,
        "   ข้อความจริงอยู่บนจอ/stderr ไม่ได้อยู่ใน TAP · รันซ้ำแล้วอ่านบรรทัดแรก ๆ ของ output"
      );
    } else if (plan) {
      head.push("", "✅ ไม่มีเทสที่แดงในรอบนี้");
    }
    return `${head.join(NL)}${NL}`;
  }

  const tapName = meta.tap ?? "ไฟล์ TAP";
  const parts = [...head, "", `พบ ${failures.length} เทสที่แดง:`, ""];
  failures.slice(0, DETAILED_FAILURE_BUDGET).forEach((failure, index) => {
    const { fields } = failure;
    // `location:` ของ tsx ชี้เป็น offset ของไฟล์ที่ bundle แล้ว (เช่น :1:77290) ซึ่งเปิดตามไม่ได้
    // — stack frame แรกที่อยู่ในไฟล์เทสจริงคือตัวที่พาไปถึงบรรทัดได้
    const where = relativeTestPath(fields.stack) ?? relativeTestPath(fields.error)
      ?? relativeTestPath(fields.location) ?? "(ไม่ทราบไฟล์)";
    const tapRef = `${tapName} บรรทัด ${failure.tapLine}`;
    parts.push(
      RULE,
      `[${index + 1}/${failures.length}] ${failure.name}`,
      `ที่: ${where}`,
      [
        fields.code ? `code=${fields.code}` : null,
        fields.operator ? `operator=${fields.operator}` : null,
        fields.failureType ? `failureType=${fields.failureType}` : null,
      ].filter(Boolean).join("  ") || "(ไม่มีรายละเอียดชนิดของความล้มเหลว)",
      ...budgeted("error", fields.error, ERROR_LINE_BUDGET, tapRef),
      ...budgeted("expected", fields.expected, VALUE_LINE_BUDGET, tapRef),
      ...budgeted("actual", fields.actual, VALUE_LINE_BUDGET, tapRef),
      ""
    );
  });
  if (failures.length > DETAILED_FAILURE_BUDGET) {
    parts.push(
      RULE,
      `อีก ${failures.length - DETAILED_FAILURE_BUDGET} ตัวที่แดง (ชื่ออย่างเดียว):`,
      ...failures.slice(DETAILED_FAILURE_BUDGET).map((failure) => `  - ${failure.name}`),
      ""
    );
  }
  return parts.join(NL);
}
