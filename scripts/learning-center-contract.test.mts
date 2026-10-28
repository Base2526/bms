import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { businessTrackIds, getTrackLessons, isRestaurantFormat, isRetailFormat, isTrack, lessons, searchLessons, specialistTrackIds, trackOrder } from "../apps/web/lib/learning/catalog.ts";
import { inventoryNarrationCues } from "../apps/web/lib/learning/inventoryNarration.ts";
import { businessGuideFlows, businessNarrationCues, type BusinessTrackId } from "../apps/web/lib/learning/businessGuideFlow.ts";

test("public learning paths resolve unique bilingual lessons and real action destinations", () => {
  assert.equal(new Set(lessons.map((lesson) => lesson.slug)).size, lessons.length);
  for (const track of [...businessTrackIds, ...specialistTrackIds]) {
    const path = getTrackLessons(track);
    assert.equal(path.length, trackOrder[track].length);
    assert.equal(new Set(path.map((lesson) => lesson.slug)).size, path.length);
    assert.equal(path[0].slug, track === "inventory" ? "inventory-overview" : "start-here");
    assert.equal(path.at(-1)?.slug, track === "inventory" ? "inventory-rehearsal" : "launch-checklist");
    for (const lesson of path) assert.ok(lesson.tracks.includes(track));
    assert.deepEqual(new Set(path.map((lesson) => lesson.slug)), new Set(lessons.filter((lesson) => lesson.tracks.includes(track)).map((lesson) => lesson.slug)));
  }
  for (const lesson of lessons) {
    assert.match(lesson.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(lesson.steps.length >= 4);
    for (const field of [lesson.title, lesson.summary, lesson.menu, lesson.prerequisite, ...lesson.steps, lesson.check, lesson.caution]) {
      assert.ok(field.th.trim() && field.en.trim(), `${lesson.slug}: missing translation`);
      assert.doesNotMatch(`${field.th} ${field.en}`, /TODO|bms_\w+|BMS_SECRET|sk-[a-zA-Z0-9]+/);
    }
    assert.ok(["", "(main)", "(admin)", "(pos)"].some((group) => existsSync(resolve(import.meta.dirname, "../apps/web/app", group, lesson.action.slice(1), "page.tsx"))), `Missing destination: ${lesson.action}`);
  }
});

test("inventory is a cross-business specialist guide with the complete controlled stock lifecycle", () => {
  assert.deepEqual(businessTrackIds, ["retail", "board-game", "restaurant", "pharmacy"]);
  assert.deepEqual(specialistTrackIds, ["inventory"]);
  const path = getTrackLessons("inventory");
  const slugs = path.map((lesson) => lesson.slug);
  for (const required of [
    "inventory-overview", "products-import", "inventory-catalog-models", "inventory-branch-balances",
    "inventory", "inventory-purchase-receiving", "inventory-requisitions", "inventory-transfer-control",
    "inventory-count-control", "inventory-reservations", "inventory-lots-quality", "inventory-wastage",
    "inventory-ai-assistant", "inventory-reports-recovery", "inventory-rehearsal",
  ]) assert.ok(slugs.includes(required), `Inventory guide is missing ${required}`);
  const inventoryText = path.flatMap((lesson) => [lesson.title, lesson.summary, ...lesson.steps, lesson.check, lesson.caution])
    .map((copy) => `${copy.th} ${copy.en}`).join(" ");
  assert.match(inventoryText, /send then receive|Send.*Receive|ส่ง.*รับ/);
  assert.match(inventoryText, /counted.*snapshot|counted − snapshot|Snapshot/);
  assert.match(inventoryText, /reserved|ยอดจอง/);
  assert.match(inventoryText, /quarantine|กักกัน/);
  assert.match(inventoryText, /unknown|ไม่ทราบ/);
  assert.match(inventoryText, /Excel.*CSV.*PDF|Excel, CSV or PDF/);
  assert.match(inventoryText, /human.*confirm|คน.*ยืนยัน/);
  assert.equal(isTrack("inventory"), true);
});

test("inventory Thai narration ships one verified recording for every highlighted cue", () => {
  const manifest = JSON.parse(readFileSync(new URL("../apps/web/app/learn/inventoryThaiAudio.json", import.meta.url), "utf8"));
  const provenance = JSON.parse(readFileSync(new URL("../apps/web/public/audio/inventory/th/provenance.json", import.meta.url), "utf8"));
  const texts = inventoryNarrationCues.th.map((cue) => cue.text);
  assert.deepEqual(Object.keys(manifest), texts);
  assert.deepEqual(inventoryNarrationCues.th.map((cue) => cue.target), [
    "product", "receiving", "sellable", "reservation", "handoff", "deduction",
    "transfer", "transit", "outcome", "snapshot", "physical-count", "approve-delta", "adjust-delta",
    "customer", "owner",
  ]);
  assert.match(inventoryNarrationCues.th.at(-1)?.text ?? "", /แอดมิน.*ยอดขาย.*สต็อก.*ส่งออกรายงาน.*ยืนยัน/);
  for (const text of texts) {
    const id = createHash("sha256").update(text).digest("hex").slice(0, 24);
    const recording = manifest[text];
    assert.equal(recording.file, `/audio/inventory/th/${id}.mp3`);
    assert.ok(recording.duration > 0.2 && recording.duration < 90);
    const file = new URL(`../apps/web/public${recording.file}`, import.meta.url);
    assert.ok(statSync(file).size > 1000);
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), provenance[id].sha256);
  }
});

test("all four business overviews ship bilingual flows and verified Thai narration", () => {
  const manifest = JSON.parse(readFileSync(new URL("../apps/web/app/learn/businessThaiAudio.json", import.meta.url), "utf8"));
  const provenance = JSON.parse(readFileSync(new URL("../apps/web/public/audio/learning-business/th/provenance.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(businessGuideFlows), businessTrackIds);
  for (const track of businessTrackIds as readonly BusinessTrackId[]) {
    const config = businessGuideFlows[track];
    assert.ok(config.lanes.length >= 2, `${track}: missing flow branches`);
    const targets = config.lanes.flatMap((lane) => lane.map((node) => node.target));
    assert.equal(new Set(targets).size, targets.length, `${track}: duplicate flow target`);
    assert.ok(targets.includes(config.customer.focusTarget));
    assert.ok(targets.includes(config.owner.focusTarget));
    assert.ok(config.owner.analyses.th.length >= 4 && config.owner.analyses.en.length >= 4, `${track}: incomplete Admin analysis examples`);
    for (const node of config.lanes.flat()) {
      for (const lang of ["th", "en"] as const) {
        assert.ok(node.title[lang].trim() && node.description[lang].trim() && node.narration[lang].trim());
      }
    }
    for (const { text } of businessNarrationCues(track, "th")) {
      const id = createHash("sha256").update(`${track}\0${text}`).digest("hex").slice(0, 24);
      const recording = manifest[text];
      assert.equal(recording.file, `/audio/learning-business/th/${id}.mp3`);
      assert.ok(recording.duration > 0.2 && recording.duration < 90);
      const file = new URL(`../apps/web/public${recording.file}`, import.meta.url);
      assert.ok(statSync(file).size > 1000);
      assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), provenance[id].sha256);
      assert.equal(provenance[id].track, track);
    }
  }
  assert.match(businessGuideFlows.pharmacy.flowNote.th, /AI ไม่วินิจฉัย/);
  assert.match(businessGuideFlows["board-game"].flowNote.th, /กลุ่มบิลเป็นเจ้าของเงิน/);
  assert.match(businessGuideFlows.restaurant.flowNote.th, /การชำระเงินไม่สร้างงานครัว/);
  assert.match(businessGuideFlows.retail.owner.limit.th, /ปรับสต็อก.*ยืนยัน/);
  assert.match(businessNarrationCues("retail", "th").at(-1)?.text ?? "", /แอดมิน.*ยอดขาย.*โปรโมชัน.*ส่งออกรายงาน.*ยืนยัน/);
  assert.match(businessNarrationCues("board-game", "th").at(-1)?.text ?? "", /แอดมิน.*รายได้ต่อโต๊ะ.*โนโชว์.*ส่งออกรายงาน.*ยืนยัน/);
  assert.match(businessNarrationCues("restaurant", "th").at(-1)?.text ?? "", /แอดมิน.*ยอดเฉลี่ยต่อบิล.*ฟู้ดคอสต์.*คอขวด.*ส่งออกรายงาน.*ยืนยัน/);
  assert.match(businessNarrationCues("pharmacy", "th").at(-1)?.text ?? "", /แอดมิน.*วันหมดอายุ.*คิวที่รอเภสัชกร.*ไม่วินิจฉัย.*เภสัชกรที่มีใบอนุญาต/);
});

test("restaurant and cafe guide filters Restaurant POS formats without treating an ordinary counter cafe as a kitchen workflow", () => {
  const slugs = (format: "dine-in" | "counter-kitchen" | "pickup-delivery") => getTrackLessons("restaurant", format).map((lesson) => lesson.slug);
  const dineIn = slugs("dine-in");
  const counter = slugs("counter-kitchen");
  const delivery = slugs("pickup-delivery");
  for (const path of [dineIn, counter, delivery]) {
    assert.equal(path[0], "start-here");
    assert.equal(path.at(-1), "launch-checklist");
  }
  assert.ok(dineIn.includes("restaurant-floor"));
  assert.ok(dineIn.includes("restaurant-service"));
  assert.ok(dineIn.includes("restaurant-online"));
  assert.ok(counter.includes("restaurant-service"));
  assert.ok(!counter.includes("restaurant-floor"));
  assert.ok(!counter.includes("restaurant-online"));
  assert.ok(delivery.includes("restaurant-online"));
  assert.ok(!delivery.includes("restaurant-floor"));
  assert.ok(!delivery.includes("restaurant-service"));
  for (const path of [dineIn, counter, delivery]) {
    assert.ok(path.includes("restaurant-kitchen-availability"));
    assert.ok(path.includes("restaurant-costs-quality"));
    assert.ok(path.includes("restaurant-rehearsal"));
    assert.ok(path.includes("expenses-input-vat"));
  }
  assert.equal(isRestaurantFormat("counter-kitchen"), true);
  assert.equal(isRestaurantFormat("toString"), false);
});

test("retail guide covers shared POS work and reveals only the selected specialized retail lessons", () => {
  const slugs = (format: "general" | "variants" | "food-counter" | "wholesale") => getTrackLessons("retail", format).map((lesson) => lesson.slug);
  const general = slugs("general");
  const variants = slugs("variants");
  const food = slugs("food-counter");
  const wholesale = slugs("wholesale");
  for (const path of [general, variants, food, wholesale]) {
    assert.equal(path[0], "start-here");
    assert.equal(path.at(-1), "launch-checklist");
    assert.ok(path.includes("retail-pos-sale"));
    assert.ok(path.includes("retail-purchase-receiving"));
  }
  assert.ok(variants.includes("retail-variants-serials"));
  assert.ok(!general.includes("retail-variants-serials"));
  assert.ok(food.includes("retail-food-counter"));
  assert.ok(food.includes("restaurant-operations-checklists"));
  assert.ok(!wholesale.includes("retail-food-counter"));
  assert.ok(!wholesale.includes("restaurant-operations-checklists"));
  assert.ok(wholesale.includes("retail-credit-receivables"));
  assert.ok(!food.includes("retail-credit-receivables"));
  assert.equal(isRetailFormat("food-counter"), true);
  assert.equal(isRetailFormat("restaurant"), false);
});

test("pharmacy guide keeps clinical authority with licensed pharmacists and covers the safe operating lifecycle", () => {
  const path = getTrackLessons("pharmacy");
  const slugs = path.map((lesson) => lesson.slug);
  for (const required of [
    "pharmacy-readiness-licenses", "pharmacy-product-policies", "pharmacy-counter-sale",
    "pharmacy-intake-queue", "pharmacy-evidence-privacy", "pharmacy-guidance-protocols",
    "pharmacy-emergency-boundary", "pharmacy-rehearsal", "expenses-input-vat",
  ]) assert.ok(slugs.includes(required), `Pharmacy guide is missing ${required}`);
  assert.ok(path.some((lesson) => lesson.roles.includes("pharmacist")));
  const pharmacyText = path
    .filter((lesson) => lesson.slug.startsWith("pharmacy-"))
    .flatMap((lesson) => [lesson.title, lesson.summary, lesson.prerequisite, ...lesson.steps, lesson.check, lesson.caution])
    .map((copy) => `${copy.th} ${copy.en}`)
    .join(" ");
  assert.match(pharmacyText, /licensed pharmacist|เภสัชกร.*ใบอนุญาต/);
  assert.match(pharmacyText, /AI (?:neither diagnoses|ไม่วินิจฉัย)|AI.*ไม่.*อนุมัติ/);
  assert.match(pharmacyText, /default off|เริ่มต้น.*ปิด/);
  assert.doesNotMatch(pharmacyText, /AI (?:approves|diagnoses)|AI อนุมัติยา|AI วินิจฉัย/);
});

test("learning search respects role and track, handles unknown input and searches both languages", () => {
  assert.equal(searchLessons("แยกกลุ่ม", "th", "board-game")[0]?.slug, "board-game-move-split");
  assert.equal(searchLessons("second display", "en")[0]?.slug, "desktop-hardware");
  assert.ok(searchLessons("QR", "th", "restaurant", "cashier").every((lesson) => lesson.tracks.includes("restaurant") && lesson.roles.includes("cashier")));
  assert.equal(searchLessons("unmatched-example-987654321", "th").length, 0);
  assert.equal(searchLessons("<script>alert(1)</script>", "en").length, 0);
  assert.equal(searchLessons("", "en").length, lessons.length);
  assert.equal(isTrack("toString"), false);
});
