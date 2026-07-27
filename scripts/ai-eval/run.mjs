// =============================================================
// AI pipeline eval harness — 10 test cases against /api/bms/chat
// -------------------------------------------------------------
// ยิงผ่าน HTTP ตรงกับ endpoint playground เดิม (ไม่ import lib/bms/* ตรง — เลี่ยงต้องมี
// tsx/ts-node แยกสำหรับ script standalone ตัวนี้) ใช้ channel อื่นที่ไม่ใช่ "test" (default "web")
// เพื่อให้ logConversation() persist ข้อความจริง — จำเป็นสำหรับทดสอบ P0 (conversation history) และ
// P1 (turn/handoff counter) ซึ่งทั้งคู่อ่าน/เขียน bms_conversations/bms_messages
//
// ก่อนรัน:
//   1) เปิด dev server: cd apps/web && npm run dev
//   2) login ผ่าน GraphQL mutation loginAdmin (path จริงที่ /admin/login เรียก) — ห้ามใช้ /api/login
//      (REST route เก่าที่ไม่มีหน้าไหนเรียกแล้ว ดู CLAUDE.local.md § Admin session, พังง่าย)
//      ใช้คำสั่งบรรทัดเดียว ห้ามต่อบรรทัดด้วย \ (บาง terminal/paste-mode ทำ -H/-d หลุดไปเป็นคนละคำสั่ง):
//        curl -c /tmp/bms-cookies.txt -X POST http://localhost:3000/api/graphql -H 'content-type: application/json' -d '{"query":"mutation($input: LoginInput!){ loginAdmin(input:$input){ ok message } }","variables":{"input":{"email":"admin@example.com","password":"anything"}}}'
//      ต้องใช้ field "email" ใน input เท่านั้น (resolver query จาก column email ตรงๆ) — ดูรายละเอียด
//      เต็มใน README.md ของโฟลเดอร์นี้
//
// รัน:  node scripts/ai-eval/run.mjs
//
// ---- catalog ต่อร้าน (auto-discovery) ----
// ค่า default: **ไม่ hardcode สินค้าอีกต่อไป** — ก่อนรันแต่ละร้าน ยิง GraphQL query `bmsProducts`
// (ตัวเดียวกับที่ /admin/products ใช้ list, ต้องมีสิทธิ์ product.view) หาสินค้า active ที่มีสต็อกจริง
// (variant ไหน available > 0) มาใช้เป็น productKeyword/productSize ของ test case ที่ต้องสั่งซื้อจริง
// และหาตัวที่มี keywords[] ตั้งไว้ (ไม่ว่าง) มาใช้เป็น aliasKeyword ของ P-0.5 — ถ้าร้านไหนไม่มีสินค้า/
// สต็อก/keywords ที่ตรงเงื่อนไข จะ "ข้าม" เฉพาะ test case ที่ต้องพึ่งข้อมูลนั้น พร้อม log เหตุผลชัดเจน
// ไม่ fail แบบเงียบ ๆ — แต่ละร้านจึงทดสอบด้วย catalog จริงของร้านนั้นเอง ไม่ใช่ค่าเดียวกันทุกร้าน
//
// ตั้ง EVAL_PRODUCT_KEYWORD/EVAL_PRODUCT_SIZE/EVAL_PRODUCT_QTY/EVAL_ALIAS_KEYWORD (ENV) เพื่อ
// override การ auto-discover นี้ (ใช้ค่าเดียวกันทุกร้านเหมือนเดิม) — เหมาะเวลาต้องการชี้สินค้าเจาะจง
//
// ---- หลายร้านค้า (multi-tenant) ----
// ค่า default (BMS_EVAL_ALL_TENANTS ไม่ตั้ง) = ยิงแค่ "ร้านเดียว" ที่ session/cookie ปัจจุบัน resolve ไป
// (เหมือน /api/bms/chat เอง — derive tenant จาก signed admin session + ACT_TENANT_COOKIE ถ้ามี)
// ตั้ง BMS_EVAL_ALL_TENANTS=true เพื่อวนทุกร้าน — ต้อง login เป็น platform admin เท่านั้น (ใช้
// bmsIsPlatformAdmin/bmsTenants/bmsEnterTenant/bmsExitTenant ตัวเดียวกับที่หน้า /admin/tenants ใช้
// "เข้าดู" ร้าน) ไม่ใช่ platform admin จะ fallback เป็นรันร้านเดียวอัตโนมัติ พร้อม warning
// กรองบางร้านด้วย BMS_EVAL_TENANT_SLUGS (comma-separated slug)
//
// ⚠️ ทุก test case ที่ระบุ channel≠"test" จะสร้าง conversation จริงใน Inbox ของ tenant ที่ทดสอบอยู่
// (customerRef ขึ้นต้นด้วย "EVAL-" กันชนกับลูกค้าจริง) — เป็น dev-only data ลบเองได้ทีหลังถ้าต้องการ
// รันแบบ all-tenants จะเขียนข้อมูลแบบนี้ "ทุกร้าน" ไม่ใช่แค่ร้านเดียว — ระวังถ้ามีร้านจำนวนมาก
// =============================================================

import { readFileSync } from "node:fs";

const CONFIG = {
  baseUrl: process.env.BMS_EVAL_BASE_URL || "http://localhost:3000",
  cookieJarPath: process.env.BMS_EVAL_COOKIE_JAR || "/tmp/bms-cookies.txt",
  allTenants: process.env.BMS_EVAL_ALL_TENANTS === "true",
  tenantSlugs: (process.env.BMS_EVAL_TENANT_SLUGS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

// ผู้ใช้ตั้ง ENV เอง = บังคับใช้ค่านี้ทุกร้าน (ข้าม auto-discovery) — ไม่ตั้ง = null แล้วไป discover จริง
const ENV_OVERRIDE = {
  productKeyword: process.env.EVAL_PRODUCT_KEYWORD || null,
  productSize: process.env.EVAL_PRODUCT_SIZE || null,
  productQty: process.env.EVAL_PRODUCT_QTY || null,
  aliasKeyword: process.env.EVAL_ALIAS_KEYWORD || null,
};

const RUN_ID = Date.now().toString(36);

// ---- cookie state (Netscape jar ตอนเริ่ม + merge Set-Cookie ระหว่างรัน เช่นตอน bmsEnterTenant) ----
const cookieJar = new Map();

function loadCookieJar(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`❌ อ่าน cookie jar ไม่ได้: ${path} (login ก่อนตามคอมเมนต์หัวไฟล์)`);
    process.exit(1);
  }
  const pairs = raw
    .split("\n")
    // curl เขียน cookie ที่เป็น HttpOnly (เช่น ADMIN_COOKIE) เป็น "#HttpOnly_<domain>\t..." —
    // เป็นแถวข้อมูลจริง ไม่ใช่คอมเมนต์ ต้องตัด prefix นี้ทิ้งก่อนเช็คว่าเป็นคอมเมนต์หรือเปล่า
    // ไม่งั้น cookie สำคัญตัวนี้จะหายไปเงียบ ๆ (เจอเคสนี้มาแล้ว — ดู README § Troubleshooting)
    .map((line) => (line.startsWith("#HttpOnly_") ? line.slice("#HttpOnly_".length) : line))
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"))
    .filter((cols) => cols.length >= 7)
    .map((cols) => [cols[5], cols[6]]);
  if (pairs.length === 0) {
    console.error(`❌ cookie jar ว่างเปล่าหรือ format ไม่ตรง: ${path}`);
    process.exit(1);
  }
  for (const [name, value] of pairs) cookieJar.set(name, value);
}

function cookieHeader() {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** merge Set-Cookie จาก response (เช่นตอน bmsEnterTenant/bmsExitTenant เปลี่ยน ACT_TENANT_COOKIE) */
function applySetCookies(res) {
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const sc of setCookies) {
    const pair = sc.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

async function chat(message, channel, customerRef) {
  const res = await fetch(`${CONFIG.baseUrl}/api/bms/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify({ message, channel, customerRef }),
  });
  applySetCookies(res);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** ใช้กับ: bmsIsPlatformAdmin / bmsTenants / bmsEnterTenant / bmsExitTenant / bmsProducts (catalog discovery) */
async function graphqlRequest(query, variables) {
  const res = await fetch(`${CONFIG.baseUrl}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify({ query, variables }),
  });
  applySetCookies(res);
  const json = await res.json().catch(() => ({}));
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

// ---- catalog auto-discovery ต่อร้าน ----
// คืน { productKeyword, productSize, productQty, aliasKeyword } — field ไหนเป็น null แปลว่าร้านนี้
// ไม่มีข้อมูลพอให้ทดสอบเรื่องนั้น (buildCases() จะข้าม test case ที่ต้องพึ่ง field นั้นให้เอง
async function resolveCatalogSample(label) {
  if (ENV_OVERRIDE.productKeyword) {
    return {
      productKeyword: ENV_OVERRIDE.productKeyword,
      productSize: ENV_OVERRIDE.productSize || "M",
      productQty: ENV_OVERRIDE.productQty || "1",
      aliasKeyword: ENV_OVERRIDE.aliasKeyword, // อาจเป็น null ได้ถ้าไม่ตั้ง — ข้าม alias case ปกติ
    };
  }

  let items = [];
  try {
    const data = await graphqlRequest(
      `query{ bmsProducts(limit:100){ items{ sku name active keywords variants{ size available } } } }`
    );
    items = data?.bmsProducts?.items ?? [];
  } catch (err) {
    console.log(`⚠️  [${label}] ดึง catalog จริงไม่สำเร็จ (${err.message}) — ข้าม test case ที่ต้องใช้สินค้า`);
    return { productKeyword: null, productSize: null, productQty: "1", aliasKeyword: null };
  }

  const withStock = items.filter((p) => p.active && p.variants?.some((v) => v.available > 0));
  if (withStock.length === 0) {
    console.log(`⚠️  [${label}] ไม่พบสินค้า active ที่มีสต็อกเลย — ข้าม test case ที่ต้องใช้สินค้า/alias`);
    return { productKeyword: null, productSize: null, productQty: "1", aliasKeyword: null };
  }

  const withAlias = withStock.find((p) => Array.isArray(p.keywords) && p.keywords.some((k) => k?.trim()));
  const base = withAlias ?? withStock[0];
  const variant = base.variants.find((v) => v.available > 0);
  const aliasKeyword = withAlias
    ? withAlias.keywords.find((k) => k?.trim() && !withAlias.name.toLowerCase().includes(k.toLowerCase())) ??
      withAlias.keywords.find((k) => k?.trim())
    : null;

  if (!withAlias) {
    console.log(`⚠️  [${label}] ไม่มีสินค้าไหนตั้ง keywords[] ไว้เลย — ข้าม test case P-0.5/alias (ไปตั้งได้ที่ /admin/products)`);
  }
  console.log(
    `ℹ️  [${label}] catalog sample: sku=${base.sku} name="${base.name}" size=${variant.size}` +
      (aliasKeyword ? ` alias="${aliasKeyword}"` : ` alias=(ไม่มี)`)
  );

  return { productKeyword: base.name, productSize: variant.size, productQty: "1", aliasKeyword };
}

// ---- assertion helpers ----
function toolOk(trace, names) {
  return Array.isArray(trace) && trace.some((t) => t.ok && names.includes(t.tool));
}
function toolCalled(trace, name) {
  return Array.isArray(trace) && trace.some((t) => t.tool === name);
}
function asksSomething(reply) {
  return /[?？]|ไหม|คะ|ครับ|กี่/.test(reply || "");
}

// ---- global invariant — เช็คทุก turn โดยไม่ขึ้นกับ test case (P1 unverified fact guard) ----
const PRICE_PATTERN = /(\d{1,3}(,\d{3})*|\d+)\s*(บาท|฿|baht)/i;
const STOCK_PATTERN = /(มี|เหลือ)\s*(\d+)\s*(ชิ้น|ตัว|อัน|คู่|ชุด)/i;
const VERIFIED_FACT_TOOLS = new Set([
  "search_products", "get_product", "check_stock", "get_store_info",
  "get_payment_info", "get_shipping_estimate", "check_coupon",
  "list_available_coupons", "list_customer_coupons",
]);
function unverifiedFactGuardHolds(reply, trace) {
  const mentionsFact = PRICE_PATTERN.test(reply || "") || STOCK_PATTERN.test(reply || "");
  if (!mentionsFact) return true; // ไม่พูดตัวเลข ไม่มีอะไรให้ guard
  return Array.isArray(trace) && trace.some((t) => t.ok && VERIFIED_FACT_TOOLS.has(t.tool));
}

// พบจริงจาก eval รอบแรก (2026-07): AI อ้างว่า "บันทึกการโอนเงินแล้ว" โดยไม่เรียก submit_payment เลย
// (trace: []) — mirror ของ hasUnverifiedActionClaim() ใน lib/bms/pipeline.ts ให้ eval จับ regression
// แบบนี้เองอัตโนมัติ ไม่ต้องรอคนอ่าน reply ทีละบรรทัด
const ACTION_CLAIM_PATTERN =
  /(บันทึก|ยืนยัน|ทำ)(การโอนเงิน|การชำระเงิน|การชำระ|ออร์เดอร์|การสั่งซื้อ|การคืนเงิน|การยกเลิก)(ให้)?(เรียบร้อย|สำเร็จ)?แล้ว|(โอนเงิน|ชำระเงิน|สั่งซื้อ|คืนเงิน|ยกเลิกออร์เดอร์)(เรียบร้อย|สำเร็จ)แล้ว/;
const WRITE_ACTION_TOOLS = new Set(["create_order", "submit_payment", "reorder", "cancel_order", "refund_payment", "return_order"]);
function unverifiedActionClaimGuardHolds(reply, trace) {
  if (!ACTION_CLAIM_PATTERN.test(reply || "")) return true; // ไม่อ้างว่าทำอะไรสำเร็จ ไม่มีอะไรให้ guard
  return Array.isArray(trace) && trace.some((t) => t.ok && WRITE_ACTION_TOOLS.has(t.tool));
}

const HANDOFF_REPLY = "ขอโทษนะคะ ขอให้แอดมินช่วยตอบต่อในเรื่องนี้นะคะ รบกวนรอสักครู่ค่ะ 🙏";

// ---- 10 test case — สร้างจาก catalog sample ของแต่ละร้าน (sample.* อาจเป็น null บาง field) ----
function buildCases(sample) {
  const cases = [];

  if (sample.aliasKeyword) {
    cases.push({
      id: "p05-alias-search",
      title: "P-0.5: ค้นสินค้าด้วยคำพ้อง (bms_products.keywords[])",
      channel: "web",
      turns: [
        {
          message: `มี${sample.aliasKeyword}ไหม`,
          checks: (r) => [
            { desc: "เรียก search_products/check_stock สำเร็จ (เจอสินค้าจาก alias)", pass: toolOk(r.trace, ["search_products", "check_stock"]) },
          ],
        },
      ],
    });
  }

  cases.push({
    id: "p2-category-browse",
    title: "P2: ถามกว้าง ๆ ควรใช้หมวดหมู่ของร้านช่วยตอบ/ค้นหา",
    channel: "web",
    turns: [
      {
        message: "มีสินค้าอะไรบ้างคะ",
        checks: (r) => [
          { desc: "เรียก search_products สำเร็จ", pass: toolOk(r.trace, ["search_products"]) },
        ],
      },
    ],
  });

  if (sample.productKeyword) {
    cases.push({
      id: "p0-multi-turn-slot-fill",
      title: "P0: บทสนทนาหลาย turn — AI ต้องเข้าใจ turn ก่อนหน้า",
      channel: "web",
      turns: [
        {
          message: `อยากได้ ${sample.productKeyword}`,
          checks: (r) => [
            { desc: "ยังไม่สร้างออร์เดอร์ (ข้อมูลไม่ครบ)", pass: !toolOk(r.trace, ["create_order"]) },
            { desc: "ถามข้อมูลเพิ่ม (ไซซ์/จำนวน)", pass: asksSomething(r.reply) },
          ],
        },
        {
          // ยอมรับ 2 พฤติกรรมที่ถูกต้องทั้งคู่: (a) เรียกทูลไปเลย หรือ (b) สรุปยืนยันสินค้า+ไซซ์ที่ถูก
          // ก่อนเรียกทูล (ปลอดภัยกว่า แต่ยัง "เข้าใจ context" เหมือนกัน) — เจอจริงจาก eval รอบ 2:
          // AI ตอบ "ยืนยัน: Adidas Runner ไซซ์ M ใช่ไหมคะ" ไม่เรียกทูลแต่เข้าใจ context ถูกต้อง 100%
          message: sample.productSize,
          checks: (r) => [
            {
              desc: "เข้าใจว่า turn นี้ตอบไซซ์ต่อจากสินค้าที่คุยไว้ (เรียกทูล หรือ สรุปยืนยันสินค้า+ไซซ์ที่ถูกต้อง)",
              pass:
                toolOk(r.trace, ["check_stock", "search_products", "create_order"]) ||
                (String(r.reply || "").toLowerCase().includes(sample.productKeyword.toLowerCase()) &&
                  String(r.reply || "").includes(sample.productSize)),
            },
          ],
        },
      ],
    });

    cases.push({
      id: "single-field-ask-back",
      title: "#6: ข้อมูลขาดหลาย field ต้องถามทีละ 1 field",
      channel: "web",
      turns: [
        {
          message: `อยากสั่ง ${sample.productKeyword}`, // ขาดทั้งไซซ์และจำนวน
          checks: (r) => [
            { desc: "ยังไม่สร้างออร์เดอร์", pass: !toolOk(r.trace, ["create_order"]) },
            {
              desc: "ไม่ถามไซซ์กับจำนวนพร้อมกันในข้อความเดียว (heuristic)",
              pass: !(String(r.reply || "").includes("ไซซ์") && String(r.reply || "").includes("จำนวน")),
            },
          ],
        },
      ],
    });

    cases.push({
      id: "order-then-payment-happy-path",
      title: "สั่งซื้อครบข้อมูล → แจ้งโอนเงิน (create_order → submit_payment)",
      channel: "web",
      turns: [
        {
          message: `สั่ง ${sample.productKeyword} ไซซ์ ${sample.productSize} ${sample.productQty} ชิ้น ยืนยันสั่งเลยค่ะ`,
          checks: (r) => [
            { desc: "เรียก create_order สำเร็จ (หรือ insufficient stock ที่มาจาก tool จริง ไม่ใช่เดา)", pass: toolCalled(r.trace, "create_order") },
          ],
        },
        {
          message: "โอนเงินให้แล้วนะคะ",
          checks: (r) => [
            { desc: "เรียก submit_payment", pass: toolCalled(r.trace, "submit_payment") },
            { desc: "ไม่ยืนยันว่าเงินเข้าแล้ว (ต้องรอแอดมินตรวจสอบ)", pass: !/เงินเข้าแล้ว|ยืนยันการชำระ/i.test(r.reply || "") },
          ],
        },
      ],
    });
  }

  cases.push({
    id: "order-status-lookup",
    title: "ถามสถานะออร์เดอร์ของตัวเอง (get_order_status, scope ตาม channel+customerRef)",
    channel: "web",
    turns: [
      {
        message: "ออร์เดอร์ล่าสุดของฉันถึงไหนแล้ว",
        checks: (r) => [
          { desc: "เรียก get_order_status สำเร็จ", pass: toolOk(r.trace, ["get_order_status"]) },
        ],
      },
    ],
  });

  cases.push({
    id: "coupon-question-routing",
    title: "ถามคูปอง → ต้องเข้า deterministic path (couponQuestion) ไม่ใช่ AI tool loop",
    channel: "web",
    turns: [
      {
        message: "ตอนนี้มีคูปองส่วนลดอะไรบ้างคะ",
        checks: (r) => [
          { desc: "tool === couponQuestion (bypass AI loop)", pass: r.tool === "couponQuestion" },
        ],
      },
    ],
  });

  cases.push({
    id: "turn-budget-handoff",
    title: "P1: ไม่คืบหน้าติดกัน 3 ครั้ง → บังคับ handoff ครั้งที่ 4",
    channel: "web",
    turns: [
      { message: "อากาศวันนี้เป็นยังไงคะ", checks: () => [] },
      { message: "แนะนำหนังดี ๆ หน่อย", checks: () => [] },
      { message: "เล่าเรื่องตลกให้ฟังหน่อย", checks: () => [] },
      {
        message: "อีกอย่างนะ",
        checks: (r) => [
          { desc: `reply ตรงกับ HANDOFF_REPLY เป๊ะ (ครบ 3 ครั้งไม่คืบหน้า)`, pass: r.reply === HANDOFF_REPLY },
        ],
      },
    ],
  });

  cases.push({
    id: "greeting-safety",
    title: "ทักทายทั่วไป — ต้องตอบได้ปกติ ไม่มี side-effect การเขียน",
    channel: "web",
    turns: [
      {
        message: "สวัสดีค่ะ",
        checks: (r) => [
          { desc: "มี reply ไม่ว่าง", pass: Boolean(r.reply && r.reply.trim()) },
          { desc: "ไม่มี write tool ถูกเรียก", pass: !toolOk(r.trace, ["create_order", "submit_payment", "reorder", "cancel_order"]) },
        ],
      },
    ],
  });

  if (sample.aliasKeyword && sample.productSize) {
    cases.push({
      id: "alias-order-single-message",
      title: "P-0.5 + order path: สั่งซื้อด้วยคำพ้อง ไม่ใช่ชื่อ/SKU ตรง ๆ ในข้อความเดียว",
      channel: "web",
      turns: [
        {
          message: `สั่ง${sample.aliasKeyword} ไซซ์ ${sample.productSize} ${sample.productQty} ชิ้น ยืนยันเลยค่ะ`,
          checks: (r) => [
            { desc: "resolve สินค้าจาก alias ได้แล้วเรียก create_order", pass: toolCalled(r.trace, "create_order") },
          ],
        },
      ],
    });
  }

  return cases;
}

// ---- runner: ยิงทุก test case (เท่าที่ catalog sample รองรับ) กับ tenant ที่ cookie/session ชี้อยู่ตอนนี้ ----
async function runEvalSuite(label) {
  console.log(`\n${"#".repeat(60)}\n# ร้าน: ${label}\n${"#".repeat(60)}\n`);

  const sample = await resolveCatalogSample(label);
  const cases = buildCases(sample);
  const skipped = 10 - cases.length; // ไม่ตรงเป๊ะ 10 เสมอถ้า ENV override บางส่วน แต่พอสื่อสารคร่าวๆ
  if (skipped > 0) console.log(`(ข้าม test case ที่ต้องใช้ catalog ${skipped} เคส จากทั้งหมด — ดู log ด้านบน)\n`);

  let totalChecks = 0;
  let totalPassed = 0;
  let invariantChecks = 0;
  let invariantPassed = 0;
  let actionClaimChecks = 0;
  let actionClaimPassed = 0;
  const failures = [];

  for (const testCase of cases) {
    console.log(`▸ ${testCase.id} — ${testCase.title}`);
    const customerRef = `EVAL-${testCase.id}-${RUN_ID}`;

    for (let i = 0; i < testCase.turns.length; i++) {
      const turn = testCase.turns[i];
      let result;
      try {
        result = await chat(turn.message, testCase.channel, customerRef);
      } catch (err) {
        console.log(`  turn ${i + 1} [${turn.message}] → ❌ request failed: ${err.message}`);
        failures.push({ case: testCase.id, turn: i + 1, desc: "request สำเร็จ", detail: err.message });
        totalChecks += 1;
        continue;
      }

      // global invariants ทุก turn
      invariantChecks += 1;
      const invariantOk = unverifiedFactGuardHolds(result.reply, result.trace);
      if (invariantOk) invariantPassed += 1;
      else failures.push({ case: testCase.id, turn: i + 1, desc: "unverified-fact guard (global)", detail: `reply: "${result.reply}"` });

      actionClaimChecks += 1;
      const actionClaimOk = unverifiedActionClaimGuardHolds(result.reply, result.trace);
      if (actionClaimOk) actionClaimPassed += 1;
      else failures.push({ case: testCase.id, turn: i + 1, desc: "unverified-action-claim guard (global)", detail: `reply: "${result.reply}"` });

      const checks = turn.checks(result);
      for (const check of checks) {
        totalChecks += 1;
        if (check.pass) {
          totalPassed += 1;
        } else {
          failures.push({ case: testCase.id, turn: i + 1, desc: check.desc, detail: `reply: "${result.reply}" · trace: ${JSON.stringify(result.trace ?? [])}` });
        }
        console.log(`  turn ${i + 1}: ${check.pass ? "✅" : "❌"} ${check.desc}`);
      }
    }
    console.log("");
  }

  return { label, casesRun: cases.length, casesSkipped: skipped, totalChecks, totalPassed, invariantChecks, invariantPassed, actionClaimChecks, actionClaimPassed, failures };
}

function printSuiteSummary(suite) {
  const pct = suite.totalChecks ? Math.round((suite.totalPassed / suite.totalChecks) * 1000) / 10 : 0;
  const invariantPct = suite.invariantChecks ? Math.round((suite.invariantPassed / suite.invariantChecks) * 1000) / 10 : 0;
  const actionClaimPct = suite.actionClaimChecks ? Math.round((suite.actionClaimPassed / suite.actionClaimChecks) * 1000) / 10 : 0;

  console.log("=".repeat(60));
  console.log(`[${suite.label}] เคสที่รัน: ${suite.casesRun} (ข้าม ${suite.casesSkipped})`);
  console.log(`[${suite.label}] ผลรวม: ${suite.totalPassed}/${suite.totalChecks} assertions ผ่าน (${pct}%)`);
  console.log(`[${suite.label}] Unverified-fact guard (global): ${suite.invariantPassed}/${suite.invariantChecks} ผ่าน (${invariantPct}%)`);
  console.log(`[${suite.label}] Unverified-action-claim guard (global): ${suite.actionClaimPassed}/${suite.actionClaimChecks} ผ่าน (${actionClaimPct}%)`);
  if (suite.failures.length > 0) {
    console.log(`\n[${suite.label}] รายละเอียดที่ไม่ผ่าน:`);
    for (const f of suite.failures) {
      console.log(`  - [${f.case}] turn ${f.turn}: ${f.desc}\n      ${f.detail}`);
    }
  }
  console.log("=".repeat(60));
}

function sumSuites(suites, key) {
  return suites.reduce((acc, s) => acc + s[key], 0);
}

// ---- main ----
async function main() {
  loadCookieJar(CONFIG.cookieJarPath);
  console.log(`AI pipeline eval — run id ${RUN_ID}`);

  let allTenants = CONFIG.allTenants;
  if (allTenants) {
    const isPlatformAdmin = await graphqlRequest(`query{ bmsIsPlatformAdmin }`).catch((err) => {
      console.error(`⚠️  เช็ค bmsIsPlatformAdmin ไม่สำเร็จ (${err.message}) — fallback รันร้านเดียว`);
      return { bmsIsPlatformAdmin: false };
    }).then((d) => d?.bmsIsPlatformAdmin);
    if (!isPlatformAdmin) {
      console.log("⚠️  ผู้ใช้นี้ไม่ใช่ platform admin — BMS_EVAL_ALL_TENANTS ใช้ไม่ได้ fallback รันร้านเดียวตาม session ปัจจุบัน");
      allTenants = false;
    }
  }

  const suites = [];

  if (allTenants) {
    const { bmsTenants } = await graphqlRequest(`query{ bmsTenants{ id name slug active } }`);
    const targets = CONFIG.tenantSlugs.length
      ? bmsTenants.filter((t) => CONFIG.tenantSlugs.includes(t.slug))
      : bmsTenants;
    if (targets.length === 0) {
      console.error(`❌ ไม่พบร้านที่ตรงกับ BMS_EVAL_TENANT_SLUGS=${CONFIG.tenantSlugs.join(",")}`);
      process.exit(1);
    }
    console.log(`ยิงทุกร้าน (${targets.length}/${bmsTenants.length}): ${targets.map((t) => t.slug).join(", ")}`);

    for (const tenant of targets) {
      try {
        await graphqlRequest(
          `mutation($tenantId: ID!){ bmsEnterTenant(tenantId:$tenantId) }`,
          { tenantId: tenant.id }
        );
      } catch (err) {
        console.error(`❌ เข้าร้าน ${tenant.slug} ไม่สำเร็จ: ${err.message} — ข้ามร้านนี้`);
        continue;
      }
      const suite = await runEvalSuite(`${tenant.name} (${tenant.slug})`);
      suites.push(suite);
      printSuiteSummary(suite);
    }

    await graphqlRequest(`mutation{ bmsExitTenant }`).catch(() => {}); // best-effort cleanup
  } else {
    const suite = await runEvalSuite("current session tenant");
    suites.push(suite);
    printSuiteSummary(suite);
  }

  if (suites.length > 1) {
    const grandTotal = sumSuites(suites, "totalChecks");
    const grandPassed = sumSuites(suites, "totalPassed");
    const grandPct = grandTotal ? Math.round((grandPassed / grandTotal) * 1000) / 10 : 0;
    console.log(`\n${"=".repeat(60)}`);
    console.log(`สรุปรวมทุกร้าน (${suites.length} ร้าน): ${grandPassed}/${grandTotal} assertions ผ่าน (${grandPct}%)`);
    for (const s of suites) {
      const pct = s.totalChecks ? Math.round((s.totalPassed / s.totalChecks) * 1000) / 10 : 0;
      console.log(`  - ${s.label}: ${s.totalPassed}/${s.totalChecks} (${pct}%) · เคสที่รัน ${s.casesRun}/ข้าม ${s.casesSkipped}`);
    }
    console.log("=".repeat(60));
  }

  console.log(
    "\n⚠️ LLM ไม่ deterministic — รันซ้ำ 2-3 รอบถ้าเคสไหน fail แค่บางรอบ ให้ถือเป็น flaky ไม่ใช่ regression จริง"
  );

  const anyFailure = suites.some((s) => s.failures.length > 0);
  process.exit(anyFailure ? 1 : 0);
}

main();
