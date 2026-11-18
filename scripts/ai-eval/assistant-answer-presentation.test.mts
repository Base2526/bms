import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAssistantAnswer } from "../../apps/web/components/work-assistant/assistantAnswerFormat.ts";
import { formatGeneratedCustomerReply } from "../../apps/web/lib/bms/customerReplyPresentation.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

test("assistant answers separate headings, paragraphs, and steps without changing their wording", () => {
  assert.deepEqual(parseAssistantAnswer("**สินค้า**\r\nจากภาพอยู่เหนือรายการ\r\n\r\n1. เปิดเมนู\r\n2. เลือกหมวด\r\n\r\nดูเพิ่มเติมที่ https://example.test/shop"), [
    { kind: "heading", text: "สินค้า" },
    { kind: "paragraph", text: "จากภาพอยู่เหนือรายการ" },
    { kind: "list", ordered: true, start: 1, items: ["เปิดเมนู", "เลือกหมวด"] },
    { kind: "paragraph", text: "ดูเพิ่มเติมที่ https://example.test/shop" },
  ]);
  assert.deepEqual(parseAssistantAnswer("# Help\n- One\n- Two\nA line\nNext line"), [
    { kind: "heading", text: "Help" },
    { kind: "list", ordered: false, items: ["One", "Two"] },
    { kind: "paragraph", text: "A line\nNext line" },
  ]);
  assert.deepEqual(parseAssistantAnswer("3. Third\n4. Fourth\n6. Sixth\n```ts\n# a comment\nconst n = 3;\n```"), [
    { kind: "list", ordered: true, start: 3, items: ["Third", "Fourth"] },
    { kind: "list", ordered: true, start: 6, items: ["Sixth"] },
    { kind: "code", text: "# a comment\nconst n = 3;" },
  ]);
});

test("customer model prose becomes plain text while verified values and links stay intact", () => {
  assert.equal(formatGeneratedCustomerReply("## รายการ\r\n**Acqua Di Gio** 2,390 ฿  \r\n\r\n\r\nดูที่ `https://example.test/item/268`"),
    "รายการ\nAcqua Di Gio 2,390 ฿\n\nดูที่ https://example.test/item/268");
  assert.equal(formatGeneratedCustomerReply("คำตอบตามร้าน\n\n1. ตรวจรายการ\n2. ยืนยัน"),
    "คำตอบตามร้าน\n\n1. ตรวจรายการ\n2. ยืนยัน");
  assert.equal(formatGeneratedCustomerReply("เรื่องแรก\n\n## เรื่องถัดไป\nรายละเอียด"),
    "เรื่องแรก\n\nเรื่องถัดไป\nรายละเอียด");
});

test("both staff surfaces use safe shared rendering and image previews remain temporary", () => {
  const renderer = read("apps/web/components/work-assistant/AssistantAnswer.tsx");
  const page = read("apps/web/app/(admin)/admin/assistant/page.tsx");
  const drawer = read("apps/web/components/work-assistant/WorkAssistantDrawer.tsx");
  const pipeline = read("apps/web/lib/bms/pipeline.ts");
  const legacyAi = read("apps/web/lib/bms/ai.ts");
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML/);
  assert.match(renderer, /REPORT_DOWNLOAD_RE/);
  assert.match(page, /<AssistantAnswer/);
  assert.match(drawer, /<AssistantAnswer/);
  assert.match(page, /preceding\.imagePreviewUrl/);
  assert.match(drawer, /preceding\.imagePreviewUrl/);
  assert.match(page, /imagePreviewUrl, imageFile, \.\.\.bubble/);
  assert.match(drawer, /function persisted\([\s\S]*?imageName, createdAt/);
  assert.match(pipeline, /inputChoiceReply && loop\.reply === inputChoiceReply[\s\S]*?formatGeneratedCustomerReply\(loop\.reply\)/);
  assert.match(pipeline, /formatGeneratedCustomerReply\(profile\.businessArchetype === "board_game_cafe"/);
  assert.match(legacyAi, /return formatGeneratedCustomerReply\(parsed\.text\)/);
  assert.match(page, /imageShownWithAnswer \? undefined : b\.imagePreviewUrl/);
  assert.match(drawer, /imageShownWithAnswer \? undefined : item\.imagePreviewUrl/);
});
