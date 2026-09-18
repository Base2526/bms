/**
 * แท็บ "โต๊ะ/เวลา" ของเครื่องขายบนเบราว์เซอร์ — กติกาที่ถ้าหลุดแล้วไม่มีใครเห็น
 * ===========================================================================
 * ไฟล์นี้ตรึงสองเรื่องที่วัดมาจากจอจริง (dev server + React tree จริง) ไม่ใช่จากการอ่านโค้ด:
 *
 *   1. **เรขาคณิตบนจอโทรศัพท์** · วัดที่ 320px: แถว "เกมที่ยืม" กว้าง 240 จบที่ x=280 แต่
 *      กลุ่มปุ่มของมันกว้าง 181 ไปจบที่ **x=327 = พ้นจอ 7px** โดยที่หน้าไม่มี scroller
 *      แนวนอนให้เลื่อนไปหา (`document.scrollWidth === 320`) · ปุ่มที่หลุดคือ "คืนแบบมีปัญหา"
 *      ซึ่งเป็นทางเดียวที่ร้านบันทึกว่ากล่องเกมหาย/พัง — ปุ่มที่กดไม่ถึงเท่ากับไม่มีปุ่ม
 *      · และผังโต๊ะได้ **คอลัมน์เดียวทั้งที่ 320 และ 375** ซึ่งไม่ใช่ผัง มันคือลิสต์
 *
 *   2. **ตัวเลขเงินต้องไม่โกหก** · `bms_board_game_billing_groups.amount_due` คือค่าเล่นที่
 *      **แช่ไว้ตอนปิดบิล** (`9.89`) กลุ่มที่ยังเล่นอยู่จึงเป็น 0 เสมอ · `/admin/board-game`
 *      และแอป RN แสดงยอดเฉพาะตอน CLOSING มาตลอด จอนี้เคยเป็นที่เดียวที่พิมพ์ทุกสถานะ
 *      แล้วโต๊ะที่เล่นมาสองชั่วโมงขึ้นว่า ฿0.00
 *
 * ⚠️ ทุก assertion อ่านซอร์สที่ **ตัดคอมเมนต์ออกแล้ว** — คอมเมนต์ในไฟล์ที่ถูกตรึงอธิบายกฎ
 * พวกนี้ด้วยคำเดียวกัน การสแกนซอร์สดิบจะทำให้คอมเมนต์ทำให้เทสผ่าน/แดงได้เอง ซึ่งเป็นกับดัก
 * เดิมของเทสสแกนซอร์สในรีโปนี้
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const PANEL_PATH = "../apps/web/components/pos/BoardGamePanel.tsx";
const CSS_PATH = "../apps/web/app/(pos)/pos/pos.css";
const PAGE_PATH = "../apps/web/app/(pos)/pos/page.tsx";
const ADMIN_PATH = "../apps/web/app/(admin)/admin/board-game/page.tsx";
const MOBILE_PATH = "../apps/mobile/src/screens/boardGame/BoardGameScreen.tsx";
const DESKTOP_RENDERER_PATH = "../apps/web/components/pos-desktop/DesktopPosRenderer.tsx";
const DESKTOP_CSS_PATH = "../apps/web/components/pos-desktop/DesktopPosRenderer.module.css";

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const panel = withoutComments(read(PANEL_PATH));
const css = withoutComments(read(CSS_PATH));
const page = withoutComments(read(PAGE_PATH));
const admin = withoutComments(read(ADMIN_PATH));
const mobile = withoutComments(read(MOBILE_PATH));
const desktopRenderer = withoutComments(read(DESKTOP_RENDERER_PATH));
const desktopCss = withoutComments(read(DESKTOP_CSS_PATH));

/**
 * กฎ CSS ทั้งไฟล์พร้อมเงื่อนไข media ของมัน — ต้องรวม body ของ **ทุกกฎ** ที่เล็ง selector
 * เดียวกัน เพราะ selector หนึ่งถูกประกาศได้หลายที่ (กับดักที่เคยทำให้เทสของ
 * `/pos/restaurant` แดงด้วยเหตุผลผิด)
 */
type CssRule = { selector: string; body: string; media: string | null };

function cssRules(source: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: Array<string | null> = [null];
  let buffer = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      const head = buffer.trim();
      buffer = "";
      if (head.startsWith("@")) {
        stack.push(head);
        continue;
      }
      // เก็บ body จนถึงปีกกาปิดของตัวเอง (กฎธรรมดาไม่มีบล็อกซ้อน)
      let depth = 1;
      let body = "";
      i += 1;
      for (; i < source.length && depth > 0; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") { depth -= 1; if (depth === 0) break; }
        body += source[i];
      }
      rules.push({ selector: head, body, media: stack[stack.length - 1] ?? null });
      continue;
    }
    if (ch === "}") { if (stack.length > 1) stack.pop(); buffer = ""; continue; }
    buffer += ch;
  }
  return rules;
}

const rules = cssRules(css);

/**
 * ตัวแท็ก JSX หนึ่งตัวเต็ม ๆ นับจากตำแหน่งที่ให้ — ต้องนับปีกกาเอง เพราะ prop ของ JSX
 * มี `{...}` ซ้อนได้ (`onKeyDown={(e) => { ... }}`) · regex สั้น ๆ จะตัดกลางแท็กแล้ว
 * รายงานว่า "ไม่มี handler" ทั้งที่มันอยู่ตรงนั้น
 */
function jsxTagAt(source: string, at: number): string {
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return source.slice(at, i + 1);
  }
  throw new Error("unterminated JSX tag");
}

/**
 * เนื้อในของ `<div className="...">` ตัวที่ขึ้นต้นที่ตำแหน่งนั้น จนถึง `</div>` ของตัวเอง
 * (นับความลึกเอง ไม่ใช่หา `</div>` ตัวแรกที่เจอ)
 */
function divBodyAt(source: string, at: number): string {
  let depth = 0;
  for (let i = at; i < source.length; i += 1) {
    if (source.startsWith("<div", i)) depth += 1;
    else if (source.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 6);
    }
  }
  throw new Error("unterminated <div>");
}

/** ค่าของ property หนึ่งสำหรับ selector หนึ่ง ภายใต้ media ที่ระบุ (null = กฎฐาน) */
function declaration(selector: string, property: string, media: string | null = null): string | null {
  let found: string | null = null;
  for (const rule of rules) {
    if (rule.media !== media) continue;
    const targets = rule.selector.split(",").map((part) => part.trim());
    if (!targets.includes(selector)) continue;
    const match = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`).exec(rule.body);
    if (match) found = match[1].trim();
  }
  return found;
}

const PHONE_MEDIA = rules.map((rule) => rule.media).find(
  (media) => media != null && /max-width:\s*520px/.test(media),
) ?? null;

test("the board-game workspace uses the full register instead of leaving an empty payment pane", () => {
  assert.match(
    page,
    /tab\s*===\s*["']boardgame["'][\s\S]{0,100}pos-main-grid--boardgame/,
    "the board-game tab must opt into its dedicated full-width grid",
  );
  assert.equal(
    declaration(".pos-main-grid--boardgame", "grid-template-columns"),
    "minmax(0, 1fr) !important",
    "the board-game workspace must own the full available width",
  );
  assert.equal(
    declaration(".pos-main-grid--boardgame > .pos-pane:last-child", "display"),
    null,
    "the single board-game work pane must never be hidden as the grid's last child",
  );
  assert.match(
    page,
    /\{tab\s*===\s*["']sell["']\s*&&\s*\(\s*<section className=["']pos-card pos-pane pos-sale-checkout["']/,
    "the payment pane must be absent outside the sell tab instead of hidden by child position",
  );
  assert.equal(
    declaration(".pos-main-grid--boardgame > .pos-work-panel", "overflow"),
    "hidden",
    "the visible board-game work panel must own the full-height embedded workspace",
  );
});

test("an open table is a scannable workspace instead of one long form", () => {
  assert.equal(
    declaration(".pos-bg-master-detail", "display"),
    "grid",
    "the floor and selected table must share one master-detail workspace",
  );
  assert.match(
    declaration(".pos-bg-master-detail", "grid-template-columns") ?? "",
    /64fr[\s\S]*36fr/,
    "the floor should keep the same workspace/detail split as the sales screen",
  );
  assert.equal(
    declaration(".pos-bg-master-pane", "overflow-y"),
    "auto",
    "the floor must scroll independently so the selected-table detail stays visible",
  );
  assert.equal(
    declaration(".pos-bg-detail-pane", "overflow-y"),
    "auto",
    "the selected-table detail must scroll without pushing the floor away",
  );
  assert.equal(
    declaration(".pos-bg-workspace", "background"),
    "var(--pos-bg)",
    "the board-game workspace must expose a neutral gutter between its two cards",
  );
  for (const selector of [".pos-bg-master-pane", ".pos-bg-detail-pane"]) {
    assert.equal(
      declaration(selector, "border"),
      "1px solid var(--pos-line)",
      `${selector} must own its border instead of sharing one outer frame`,
    );
    assert.equal(
      declaration(selector, "background"),
      "var(--pos-surface)",
      `${selector} must own an independent card background`,
    );
  }
  assert.match(
    desktopRenderer,
    /activeModule\s*===\s*["']boardgame["'][\s\S]*?styles\.boardGameModuleHost/,
    "the desktop shell must remove its shared outer card for the board-game workspace",
  );
  assert.match(
    desktopCss,
    /\.boardGameModuleHost\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/,
    "the board-game desktop host must leave the gutter visible instead of painting one connected background",
  );
  assert.match(
    panel,
    /<details className="[^"]*pos-bg-advanced-menu[^"]*">[\s\S]*?งานเพิ่มเติม · ย้ายโต๊ะ \/ แก้เวลา \/ ยกเลิก/,
    "rare move, timing, and cancellation work must share one collapsed advanced menu",
  );
  assert.match(
    panel,
    /role="tablist" aria-label="งานของโต๊ะนี้"/,
    "the detail pane must split overview, tab items, and games instead of stacking every form",
  );
  for (const value of ["overview", "tab", "games"]) {
    assert.match(panel, new RegExp(`detailTab === '${value}'`), `the ${value} detail view must render on demand`);
  }
  assert.match(
    panel,
    /className="[^"]*pos-bg-section--checkout[^"]*"[\s\S]{0,180}หยุดเวลา \/ เก็บเงิน/,
    "the primary session completion action must have its own prominent section",
  );
  assert.match(panel, /pos-bg-primary-action/, "the primary close / collect action must match the visual spec");
  assert.match(panel, /pos-bg-floor-stats/, "the floor must expose the same four status pills as the visual spec");
  assert.match(panel, /pos-bg-section--preclose/, "overview must preview games and held identity before closing");
  assert.match(panel, /pos-bg-quick-actions/, "overview must keep add-player and add-time actions in the two-button row from the visual spec");
  assert.match(
    panel,
    /showCloseChoices\s*&&[\s\S]{0,180}billingGroups\.length\s*>\s*1/,
    "split-bill choices must stay hidden until the primary action asks for them",
  );
  // ⚠️ กฎคือ "ตัวนับอยู่ที่ pill ที่เดียว" ไม่ใช่ "ห้ามมีลิสต์โต๊ะที่ต้องดู" — pill ตอบได้แค่ว่า
  // มีกี่โต๊ะ ตอบไม่ได้ว่าโต๊ะไหนและช้าไปเท่าไร ซึ่งเป็นคำถามที่คนหน้าเคาน์เตอร์ต้องตอบก่อนเดินไป
  // ถ้าบล็อกนี้ถูกเรนเดอร์ มันจึงต้องบอกเวลาของโต๊ะนั้นเอง และกดแล้วต้องพาไปที่โต๊ะนั้นจริง
  // ไม่ใช่แถวชิปที่พิมพ์ตัวเลขชุดเดิมซ้ำแล้วกดไม่ได้ (รูปที่ถูกถอดออกไปตอนทำจอ master/detail)
  if (panel.includes("pos-bg-attention-list")) {
    assert.match(
      panel,
      /pos-bg-attention-item[\s\S]{0,400}selectTable\(/,
      "an attention entry must open that table, not only count it",
    );
    assert.match(
      panel,
      /pos-bg-attention-item[\s\S]{0,500}attentionLabel\(/,
      "an attention entry must carry that table's own lateness instead of repeating the shared pill counts",
    );
    assert.match(
      panel,
      /function attentionLabel[\s\S]{0,400}expectedEndAt/,
      "lateness must come from the session's expected end, not from the alert enum alone",
    );
  }
  assert.match(
    page,
    /session\s*&&\s*!canSell\s*&&\s*tab\s*!==\s*["']boardgame["']/,
    "the sales-only readiness card must not consume the board-game workspace",
  );
});

test("time alerts stay useful at the deadline and after a session is extended", () => {
  for (const [surface, source] of [["browser POS", panel], ["admin", admin], ["native POS", mobile]] as const) {
    assert.match(
      source,
      /Math\.max\(1,\s*Math\.ceil\(Math\.abs\(remainingMs\)/,
      `${surface} must show at least one overdue minute instead of \"0 minutes over\" at the deadline`,
    );
  }
  assert.match(
    mobile,
    /const active = new Set<string>\(\)[\s\S]{0,900}notified\.current = active/,
    "native alerts must forget a warning after an extension returns the session to normal",
  );
});

test("board-game mode buttons remain visible outside the returns color scope", () => {
  assert.match(
    declaration(".pos-root .pos-ret-btn--primary", "background") ?? "",
    /var\(--ret-accent,\s*var\(--pos-accent\)\)/,
    "the selected billing mode must fall back to the POS accent when --ret-accent is out of scope",
  );
  assert.match(
    declaration(".pos-root .pos-ret-btn--open", "background") ?? "",
    /var\(--ret-accent-bg,\s*var\(--pos-accent-bg\)\)/,
    "shared open-state buttons must not become transparent when return-only variables are absent",
  );
});

test("the register keeps a phone-sized floor plan instead of a one-table list", () => {
  assert.ok(PHONE_MEDIA, "pos.css must declare a phone breakpoint for the board-game floor");

  const base = declaration(".pos-bg-floor", "grid-template-columns");
  const phone = declaration(".pos-bg-floor", "grid-template-columns", PHONE_MEDIA);
  assert.ok(base, ".pos-bg-floor must declare a base track");
  assert.ok(phone, ".pos-bg-floor must declare a phone track");

  assert.match(base!, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "the desktop floor must match the three-column design");
  assert.match(phone!, /repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "the phone floor must preserve a two-column map");
});

test("a row that pairs text with buttons gives way before it leaves the screen", () => {
  // แถวต้องตกบรรทัดได้ ไม่ใช่ดันปุ่มออกนอกกรอบ
  assert.equal(
    declaration(".pos-bg-row", "flex-wrap"), "wrap",
    "the list row must wrap; nowrap is how the return buttons ended up 7px off-screen at 320px",
  );
  // คอลัมน์ข้อความต้องหดได้ — ไม่มี `min-width: 0` มันจะไม่ยอมเล็กกว่า min-content
  assert.equal(
    declaration(".pos-bg-row-main", "min-width"), "0",
    "the text column must be allowed to shrink below its min-content width",
  );
  assert.equal(
    declaration(".pos-bg-row-actions", "flex-wrap"), "wrap",
    "the button group must wrap too — two nowrap buttons side by side is what overflowed",
  );

  // และแถวแบบเดิมต้องไม่กลับมาเป็น inline style · นี่คือรูปที่บั๊กเข้ามาครั้งแรก
  assert.ok(
    !/justifyContent:\s*'space-between'/.test(panel),
    "the register panel must use .pos-bg-row, not a fresh inline space-between row",
  );
});

test("an action button that fills its row wraps its label instead of painting outside itself", () => {
  // `.pos-ret-btn` เป็น nowrap ซึ่งถูกสำหรับปุ่มในแถว · ปุ่มที่ถูกยืดเต็มคอลัมน์ไม่โตตามป้าย
  // วัดแล้วที่ 320px: ป้ายยาวขึ้นอีกหน่อยเดียว ตัวหนังสือจะพ้นกรอบปุ่มไปวาดทับของข้าง ๆ
  // (textRight 314 บนปุ่มที่จบที่ 280)
  assert.equal(
    declaration(".pos-root .pos-bg-action", "white-space"), "normal",
    "the full-width action button must be allowed to wrap",
  );

  // ⚠️ "อย่างน้อย N ปุ่มมีคลาสนี้" เป็นเทสที่ผ่านได้แม้ปุ่มหนึ่งจะหลุด · กฎจริงคือ **ทุก**
  // ปุ่มที่อยู่ในคอลัมน์ปุ่ม (ซึ่งยืดเต็มความกว้างโดยโครงสร้าง) ต้องตัดบรรทัดได้
  const stacks = [...panel.matchAll(/<div className="pos-bg-actions-stack[^"]*"/g)]
    .map((match) => divBodyAt(panel, match.index!));
  assert.ok(stacks.length >= 3, "the close / collect blocks must stack their actions");
  for (const stack of stacks) {
    const buttons = [...stack.matchAll(/className="pos-ret-btn[^"]*"/g)].map((m) => m[0]);
    assert.ok(buttons.length > 0, "an actions stack with no button is dead markup");
    for (const button of buttons) {
      assert.ok(
        button.includes("pos-bg-action"),
        `a button stretched by .pos-bg-actions-stack must be able to wrap: ${button}`,
      );
    }
  }

  // และปุ่มที่จบงานทั้งบล็อกแต่ไม่ได้อยู่ในคอลัมน์ ก็ยังกินเต็มแถวเหมือนกัน
  for (const anchor of ["เปิดโต๊ะ (", "กลับไปที่ผังโต๊ะ"]) {
    const at = panel.indexOf(anchor);
    assert.ok(at > 0, `the panel must still offer "${anchor}"`);
    const before = panel.lastIndexOf("<button", at);
    assert.ok(
      jsxTagAt(panel, before).includes("pos-bg-action"),
      `"${anchor}" fills its row and must be able to wrap`,
    );
  }
});

test("the register never prints a board-game amount that has not been frozen yet", () => {
  // `session.amountDue` รวมค่าเล่นของกลุ่มที่ยังเล่นอยู่ไว้เป็น 0 — พิมพ์ออกมาตรง ๆ
  // = บอกว่าโต๊ะที่เล่นมาสองชั่วโมงไม่ติดเงิน
  assert.ok(
    !/session\.amountDue/.test(panel),
    "session.amountDue is the frozen play charge; rendering it raw prints ฿0.00 on a running table",
  );

  // ยอดบนการ์ดโต๊ะขึ้นได้ต่อเมื่อมีบิลที่ปิดเวลาแล้วรอเก็บจริง
  const tile = panel.slice(panel.indexOf("pos-bg-table-money") - 400, panel.indexOf("pos-bg-table-money") + 200);
  assert.ok(tile.length > 0, "the floor tile must still render a money line");
  assert.ok(
    /awaitingPaymentCount\s*>\s*0[\s\S]{0,120}pos-bg-table-money/.test(tile),
    "the tile amount must be gated on there actually being a bill waiting to be collected",
  );

  // และหัวการ์ดต้องแยกสองก้อนออกจากกัน ไม่ยุบเป็นเลขเดียวที่อ่านว่า "ยอดถึงตอนนี้"
  assert.ok(
    /function moneySoFar\(/.test(panel),
    "the card header must split frozen money from the open tab",
  );
  assert.ok(
    /money\.stillPlaying/.test(panel),
    "the header must say out loud that running play time is not in the number",
  );
});

test("what the panel reloads after a command is what the operator is looking at now", () => {
  // ⚠️ `run()` ถูกประกาศใหม่ทุก render จึงปิดทับ `selectedId` ของ render นั้น · callback
  // `after` ที่ล้างการเลือก (ยกเลิกโต๊ะ) ถูกทับทันทีด้วยการโหลด session ตัวเดิมกลับมา
  // = การ์ดของโต๊ะที่เพิ่งยกเลิกเด้งกลับขึ้นจอพร้อมป้าย "กำลังเล่น"
  assert.ok(
    !/if \(selectedId\) await loadSession\(selectedId\)/.test(panel),
    "run() must not reload the session id it captured at render time",
  );
  assert.ok(
    /selectedIdRef\.current/.test(panel),
    "the current selection must live in a ref that run() and the poll both read",
  );

  // และต้องมีทางเดียวที่เปลี่ยนการเลือก ไม่งั้น ref กับ state จะ drift
  const writes = [...panel.matchAll(/setSelectedId\(/g)].length;
  assert.equal(
    writes, 1,
    "setSelectedId must only be called from selectTable(), so the ref can never fall behind",
  );
});

test("a table that is already paid or cancelled stops offering commands", () => {
  assert.ok(
    /function isTerminalSession\(/.test(panel),
    "the panel must be able to tell a finished table from a running one",
  );
  assert.ok(
    /session && isTerminalSession\(session\.status\)/.test(panel)
      && /session && !isTerminalSession\(session\.status\)/.test(panel),
    "a finished table gets its own card; the control card must be gated off",
  );
  // ป้ายสถานะต้องรู้จักสถานะปลายทางด้วย ไม่งั้นมันตกไป alertLabel() แล้วอ่านว่า "กำลังเล่น"
  const label = panel.slice(panel.indexOf("function tableStateLabel"), panel.indexOf("function isTerminalSession"));
  assert.ok(label.includes("'PAID'") && label.includes("'CANCELLED'"),
    "tableStateLabel must answer for finished tables instead of falling through to alertLabel()");
});

test("the tab field the placeholder promises you can scan into actually submits", () => {
  // แท็บนี้ปิดตัวจับบาร์โค้ดรวมของเครื่องขายไว้ (`resolveScanContext` คืน DISABLED) เครื่อง
  // สแกนจึงพิมพ์ลงช่องนี้ตรง ๆ แล้วจบด้วย Enter · ช่องไม่ได้อยู่ใน <form> การไม่รับ Enter
  // แปลว่ายิงบาร์โค้ดแล้วไม่มีอะไรเกิดขึ้น
  assert.ok(
    /function addTabItem\(/.test(panel),
    "adding to the tab must be one function, not one copy per entry point",
  );
  // ⚠️ ต้องเล็งที่ **ช่องที่ placeholder สัญญาว่ายิงบาร์โค้ดได้** ไม่ใช่ "มี onKeyDown สักที่
  // ในไฟล์" — ช่องจำนวนก็มี handler เหมือนกัน เทสที่นับรวมจึงเขียวทั้งที่ช่องบาร์โค้ดเงียบไปแล้ว
  const scanAt = panel.indexOf('placeholder="ยิงบาร์โค้ดหรือพิมพ์รหัส"');
  assert.ok(scanAt > 0, "the tab must still invite the operator to scan into it");
  const scanTag = jsxTagAt(panel, panel.lastIndexOf("<input", scanAt));
  assert.ok(
    /onKeyDown=[\s\S]*'Enter'[\s\S]*addTabItem\(/.test(scanTag),
    "the field the placeholder promises you can scan into must submit on the scanner's Enter suffix",
  );
  assert.ok(
    /onClick=\{\(\) => addTabItem\(group\.id\)\}/.test(panel),
    "the button must go through the same path as Enter, or the two will drift",
  );
});

test("the register says when it stopped getting fresh data", () => {
  // ⚠️ จอที่ค้างเงียบ ๆ อ่านไม่ต่างจากจอที่ข้อมูลถูกต้อง · ป้ายต้องมาจากเวลาที่โหลด **สำเร็จ**
  // ครั้งล่าสุด ไม่ใช่จากนาฬิกาของเครื่อง ซึ่งเดินสวยตลอดแม้เน็ตตายไปแล้ว
  assert.ok(
    /feedHealth\(feed\.lastOkAt,/.test(panel),
    "feed health must be derived from useLiveRefresh's last successful load",
  );
  assert.ok(
    /pos-bg-feed/.test(panel) && declaration(".pos-bg-feed--stale", "color") != null,
    "a stale feed must look different, not just read differently",
  );
});
