import assert from "node:assert/strict";
import test from "node:test";
import { createPendingConversationChoice, confirmationChoiceOptions, inputChoiceOptions, renderConversationChoices } from "../../apps/web/lib/bms/conversationChoices.ts";
import { composeOrderQuoteSummary } from "../../apps/web/lib/bms/orderQuote.ts";
import { restaurantRequestSummary } from "../../apps/web/lib/bms/restaurantRequestPolicy.ts";
import { advanceCatalogSelection, catalogSelectionMenu, parseCatalogChoiceSelection } from "../../apps/web/lib/bms/catalogChoices.ts";
import { catalogStockMenu, stockResultMenu, insufficientStockMenu } from "../../apps/web/lib/bms/customerStockChoices.ts";
import { boardGameReservationStatusMenu, boardGameBookingActionMenu } from "../../apps/web/lib/bms/boardGameReservationPolicy.ts";

test("numbered commerce replies reach the real pipeline with exact consent and unchanged basket", async t => {
  const globals = globalThis as any;
  const previousPool = globals.__bmsPostgresPool;
  const env = { NODE_ENV: process.env.NODE_ENV, PHARMACY_INTAKE_ENABLED: process.env.PHARMACY_INTAKE_ENABLED, PHARMACY_PROTOCOLS_ENABLED: process.env.PHARMACY_PROTOCOLS_ENABLED };
  Object.assign(process.env, { NODE_ENV: "test", PHARMACY_INTAKE_ENABLED: "false", PHARMACY_PROTOCOLS_ENABLED: "" });
  let profile: any;
  let state: any;
  let history: any[];
  let calls: any[] = [];
  let failState = false;
  let failAfterClaim = false;
  let assessment: any = null;
  let restaurantRequote = false;
  let restaurantShortage = false;
  let restaurantClosed = false;
  let retailRequoteFailure = false;
  let stockOrderPreview = false;
  let stockCalls: any[] = [];
  let restockCalls: any[] = [];
  let stockResult: any = null;
  const sqlClient = { release() {}, async query(sql: string, args: any[] = []) {
    let rows: any[] = [];
    if (sql.includes("FROM bms_store_profile")) rows = [profile];
    else if (sql.includes("SELECT id FROM bms_conversations")) rows = [{ id: "FAKE-conversation" }];
    else if (sql.includes("SELECT ai_state")) rows = [{ ai_state: structuredClone(state) }];
    else if (sql.includes("FROM bms_messages")) rows = structuredClone(history);
    else if (sql.includes("FROM bms_pharmacy_assessments")) rows = assessment ? [assessment] : [];
    else if (sql.includes("UPDATE bms_conversations") && sql.includes("ai_state")) {
      if (failState) throw new Error("FAKE state unavailable");
      if (sql.includes("'{pendingConversationChoice,consumed}'")) {
        if (JSON.stringify(state.pendingConversationChoice) === args[2]) {
          state.pendingConversationChoice.consumed = true;
          rows = [{ id: "FAKE-conversation" }];
          if (failAfterClaim) failState = true;
        }
      } else state = JSON.parse(args[2]);
    }
    return { rows, rowCount: rows.length };
  } };
  globals.__bmsPostgresPool = { ...sqlClient, connect: async () => sqlClient };
  try {
    const { sharedRedisClient } = await import("../../apps/web/lib/cache.ts");
    t.mock.method(sharedRedisClient, "get", async () => null);
    t.mock.method(sharedRedisClient, "set", async () => "OK");
    t.mock.method(console, "error", () => {});
    const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected network"); });
    const { ALL_TOOLS } = await import("../../apps/web/lib/bms/tools/catalog.ts");
    const { runPipeline } = await import("../../apps/web/lib/bms/pipeline.ts");
    t.mock.method(ALL_TOOLS.find(tool => tool.name === "browse_catalog")!, "execute", async () => ({ ok: true,
      data: { products: [{ sku: "FAKE-SKU", name: "FAKE item", price: 50 }] } }));
    t.mock.method(ALL_TOOLS.find(tool => tool.name === "check_stock")!, "execute", async (args: any) => {
      stockCalls.push(args);
      return { ok: true, data: stockResult };
    });
    t.mock.method(ALL_TOOLS.find(tool => tool.name === "subscribe_restock_notification")!, "execute", async (args: any) => {
      restockCalls.push(args);
      return { ok: true, data: { status: "SUBSCRIBED" } };
    });
    t.mock.method(ALL_TOOLS.find(tool => tool.name === "search_products")!, "execute", async (args: any) => {
      assert.equal(args.keyword, "FAKE-SKU");
      return { ok: true, data: { products: [{ sku: "FAKE-SKU", name: "FAKE item", active: true }] } };
    });
    t.mock.method(ALL_TOOLS.find(tool => tool.name === "create_order")!, "execute", async (args: any, ec: any) => {
      calls.push({ args: structuredClone(args), consent: ec.customerConfirmedQuote });
      if (stockOrderPreview) {
        ec.pendingOrderQuote = { fingerprint: "FAKE-stock-quote", lines: args.items.map((item: any) => ({ ...item, name: "FAKE item", displayQty: item.qty })) };
        return { ok: true, data: { status: "CONFIRMATION_REQUIRED" } };
      }
      if (retailRequoteFailure) {
        ec.pendingOrderQuote = { fingerprint: "FAKE-updated", lines: [{ sku: "FAKE-SKU", name: "FAKE item", size: "M", displayQty: 2 }] };
        failState = true;
        return { ok: true, data: { status: "CONFIRMATION_REQUIRED" } };
      }
      if (profile.business_archetype === "restaurant") {
        if (restaurantClosed) return { ok: true, data: { status: "ORDERING_CLOSED" } };
        if (restaurantShortage) return { ok: true, data: { status: "INSUFFICIENT", sku: "FAKE-SKU", size: "M", requested: 2, available: 1 } };
        if (restaurantRequote) {
          ec.restaurantRequestQuote = { draft: args, fingerprint: "FAKE-updated", lines: [{ sku: "FAKE-SKU", name: "FAKE item", size: "M", displayQty: 2 }], locationName: "FAKE branch", fulfillmentType: "PICKUP", requestedAt: null, note: "FAKE updated" };
          return { ok: true, data: { status: "CONFIRMATION_REQUIRED" } };
        }
        ec.restaurantRequestId = "FAKE-request";
        return { ok: true, data: { status: "REQUEST_RECEIVED" } };
      }
      return { ok: false, error: "FAKE verified refusal" };
    });
    const setup = (archetype = "retail", language = "th", shortReplies = true) => {
      profile = { business_archetype: archetype, ai_language: language, ai_interpret_short_replies: shortReplies };
      calls = []; failState = false; failAfterClaim = false;
      const lines = [{ sku: "FAKE-SKU", name: "FAKE item", size: "M", displayQty: 2 }];
      const summary = archetype === "restaurant"
        ? restaurantRequestSummary({ lines, locationName: "FAKE branch", fulfillmentType: "PICKUP", requestedAt: null, note: "" }, language === "en")
        : composeOrderQuoteSummary(lines, language as "en" | "th");
      state = { product: "FAKE-SKU", size: "M", qty: 2, confirmed: false, pendingQuoteFingerprint: "FAKE-fingerprint",
        ...(archetype === "restaurant" ? { pendingRestaurantRequest: { items: [{ sku: "FAKE-SKU", size: "M", qty: 2 }], locationId: "FAKE-location", fulfillmentType: "PICKUP", promisedAt: null, requestNote: "", couponCode: null } } : {}),
        pendingConversationChoice: createPendingConversationChoice({ kind: archetype === "restaurant" ? "RESTAURANT_REQUEST_CONFIRMATION" : "ORDER_CONFIRMATION", prompt: summary, options: confirmationChoiceOptions(language === "en") }) };
      history = [{ direction: "OUT", body: summary }, { direction: "IN", body: "สั่ง FAKE-SKU ไซซ์ M 2 ชิ้น" }];
      return summary;
    };
    const nextTurn = (incoming: string, reply: string) => {
      history.unshift({ direction: "IN", body: incoming });
      history.unshift({ direction: "OUT", body: reply });
    };
    await t.test("catalog -> numeric variant -> free quantity -> fresh confirmation, in both languages", async () => {
      for (const language of ["th", "en"]) {
        setup("retail", language, false); state = {}; history = []; stockCalls = [];
        const catalog = await runPipeline("มีสินค้าอะไรบ้าง", "web", "FAKE-shop", "FAKE-customer");
        assert.equal(state.pendingConversationChoice.kind, "STOCK_SELECTION");
        nextTurn("มีสินค้าอะไรบ้าง", catalog.reply);
        stockResult = { status: "SIZE_UNKNOWN", sku: "FAKE-SKU", name: "FAKE item", price: 50,
          sizes: [{ size: "250", available: 8, price: 50 }, { size: "500", available: 7, price: 75 }] };
        const variant = await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.deepEqual(stockCalls[0], { product: "FAKE-SKU" });
        nextTurn("1", variant.reply);
        stockResult = { status: "IN_STOCK", sku: "FAKE-SKU", name: "FAKE item", price: 75, size: "500", available: 7 };
        const quantity = await runPipeline("2", "web", "FAKE-shop", "FAKE-customer");
        assert.deepEqual(stockCalls[1], { product: "FAKE-SKU", size: "500" });
        assert.equal(state.pendingConversationChoice, null);
        assert.equal(state.pendingStockQuantity.size, "500");
        nextTurn("2", quantity.reply);
        stockOrderPreview = true;
        const quote = await runPipeline("3", "web", "FAKE-shop", "FAKE-customer");
        stockOrderPreview = false;
        assert.deepEqual(calls[0].args.items, [{ sku: "FAKE-SKU", size: "500", qty: 3 }]);
        assert.equal(calls[0].consent, undefined);
        assert.equal(state.pendingConversationChoice.kind, "ORDER_CONFIRMATION");
        nextTurn("3", quote.reply);
        await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.deepEqual(calls[1].consent, { fingerprint: "FAKE-stock-quote" });
        assert.equal(calls[1].args.items[0].qty, 3);
      }
    });
    await t.test("stock quantity cannot outlive its question or become zero", async () => {
      for (const reason of ["expired", "interrupted", "zero"]) {
        setup(); state.pendingConversationChoice = null;
        state.pendingStockQuantity = { sku: "FAKE-SKU", size: "M", prompt: history[0].body, expiresAt: reason === "expired" ? 1 : Date.now() + 60_000 };
        if (reason === "interrupted") history.unshift({ direction: "OUT", body: "FAKE other question" });
        const result = await runPipeline(reason === "zero" ? "0" : "2", "web", "FAKE-shop", "FAKE-customer");
        assert.equal(result.tool, "deterministic:stock_quantity_invalid");
        assert.equal(calls.length, 0);
      }
    });
    await t.test("stock restock choices only subscribe on the selected option", async () => {
      for (const code of ["1", "2", "9"]) {
        setup(); restockCalls = [];
        const menu = stockResultMenu({ status: "OUT_OF_STOCK", sku: "FAKE-SKU", name: "FAKE item", size: "M", price: 50 }, false, true)!;
        state.pendingConversationChoice = createPendingConversationChoice({ kind: "STOCK_SELECTION", prompt: menu.reply, options: menu.options });
        history[0].body = menu.reply;
        await runPipeline(code, "web", "FAKE-shop", "FAKE-customer");
        assert.equal(restockCalls.length, code === "1" ? 1 : 0);
        assert.equal(calls.length, 0);
      }
    });
    await t.test("stock shortage selection previews the entire revised basket without consent", async () => {
      setup();
      const menu = insufficientStockMenu({ status: "INSUFFICIENT", sku: "FAKE-SKU", size: "M", requested: 5, available: 2 },
        [{ sku: "FAKE-SKU", size: "M", qty: 5 }, { sku: "FAKE-OTHER", size: "L", qty: 4 }])!;
      state.pendingConversationChoice = createPendingConversationChoice({ kind: "STOCK_SELECTION", prompt: menu.reply, options: menu.options });
      history[0].body = menu.reply; stockOrderPreview = true;
      try {
        await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.deepEqual(calls[0].args.items, [{ sku: "FAKE-SKU", size: "M", qty: 2 }, { sku: "FAKE-OTHER", size: "L", qty: 4 }]);
        assert.equal(calls[0].consent, undefined);
        assert.equal(state.items.length, 2);
        assert.equal(state.pendingConversationChoice.kind, "ORDER_CONFIRMATION");
      } finally { stockOrderPreview = false; }
    });
    await t.test("restaurant shortage keeps request details while invalidating prior consent", async () => {
      setup("restaurant"); restaurantShortage = true;
      const original = structuredClone(state.pendingRestaurantRequest);
      try {
        const result = await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.equal(result.tool, "deterministic:restaurant_stock_choice");
        assert.equal(state.pendingConversationChoice.kind, "STOCK_SELECTION");
        assert.equal(state.pendingQuoteFingerprint, null);
        assert.deepEqual(state.pendingRestaurantRequest, original);
      } finally { restaurantShortage = false; }
    });
    await t.test("a closed restaurant still explains its refusal and keeps requested quantities", async () => {
      setup("restaurant"); restaurantClosed = true;
      try {
        const result = await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.equal(result.tool, "deterministic:restaurant_request_confirm");
        assert.match(result.reply, /นอกเวลารับออร์เดอร์/);
        assert.match(result.reply, /จำนวนที่แจ้งไว้ยังอยู่/);
        assert.equal(state.pendingRestaurantRequest.items[0].qty, 2);
      } finally { restaurantClosed = false; }
    });
    await t.test("failed catalog or board-game menu persistence does not show an unusable next step", async () => {
      setup(); state = {}; history = []; failState = true;
      const catalog = await runPipeline("มีสินค้าอะไรบ้าง", "web", "FAKE-shop", "FAKE-customer");
      assert.match(catalog.reply, /ยังบันทึกตัวเลือกไม่ได้/);
      const booking = { reference: "11111111", branch: "FAKE A", status: "CONFIRMED", reservedFor: "2027-01-10T11:00:00Z", timezone: "Asia/Bangkok", durationMinutes: 120, partySize: 4, rejectionReason: null };
      for (const action of ["select", "reschedule"]) {
        setup("board_game_cafe"); failAfterClaim = true;
        const menu = action === "select" ? boardGameReservationStatusMenu([booking, { ...booking, reference: "22222222" }], false) : boardGameBookingActionMenu(booking, false);
        state.pendingConversationChoice = createPendingConversationChoice({ kind: menu.kind!, prompt: menu.reply, options: menu.options });
        history[0].body = menu.reply;
        const result = await runPipeline(action === "select" ? "1" : "2", "web", "FAKE-shop", "FAKE-customer");
        assert.match(result.reply, /ยังบันทึกตัวเลือกไม่ได้/);
        assert.doesNotMatch(result.reply, /\n1\./);
      }
    });
    for (const archetype of ["retail", "restaurant"]) for (const language of ["th", "en"]) for (const shortReplies of [true, false]) {
      await t.test(`${archetype}/${language}/short=${shortReplies}: 1 confirms precisely the shown basket`, async () => {
        setup(archetype, language, shortReplies);
        await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].args.items, [{ sku: "FAKE-SKU", size: "M", qty: 2 }]);
        assert.deepEqual(calls[0].consent, { fingerprint: "FAKE-fingerprint" });
      });
    }
    await t.test("confirmation uses the exact quoted draft including packs, modifiers and fulfillment", async () => {
      setup();
      const draft = { items: [{ sku: "FAKE-SKU", size: "M", qty: 2, packCode: "BOX", modifierCodes: ["FAKE-EXTRA"] }],
        couponCode: "FAKE-COUPON", preferredCarrier: "FAKE-CARRIER", locationId: "FAKE-location", fulfillmentType: "PICKUP",
        promisedAt: "2027-01-10T11:00:00Z", requestNote: "FAKE note" };
      state.pendingOrderDraft = structuredClone(draft);
      await runPipeline("๑ นะครับ", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, draft);
      assert.deepEqual(calls[0].consent, { fingerprint: "FAKE-fingerprint" });
    });
    await t.test("changing topic clears a pending stock quantity before an early catalog reply", async () => {
      setup(); state.pendingConversationChoice = null;
      state.pendingStockQuantity = { sku: "FAKE-OLD", size: "L", prompt: history[0].body, expiresAt: Date.now() + 60_000 };
      await runPipeline("มีสินค้าอะไรบ้าง", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(state.pendingStockQuantity, null);
      assert.equal(state.pendingConversationChoice.kind, "STOCK_SELECTION");
      assert.equal(calls.length, 0);
    });
    await t.test("an input choice cannot be reused as a quantity from a previous question", async () => {
      setup();
      const options = inputChoiceOptions(["มีสินค้าอะไรบ้าง", "กลับ"]);
      const prompt = renderConversationChoices("FAKE question", options);
      state.pendingConversationChoice = createPendingConversationChoice({ kind: "INPUT_SELECTION", prompt, options });
      state.pendingStockQuantity = { sku: "FAKE-OLD", size: "L", prompt, expiresAt: Date.now() + 60_000 };
      history[0].body = prompt;
      await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(state.pendingStockQuantity, null);
      assert.equal(calls.length, 0);
    });
    await t.test("2 edits, while 0/10 repeat the menu without calling a business tool", async () => {
      for (const code of ["2", "0", "10", "123456", "๐"]) {
        const summary = setup();
        const result = await runPipeline(code, "web", "FAKE-shop", "FAKE-customer");
        assert.equal(calls.length, 0);
        if (code === "2") assert.equal(state.pendingQuoteFingerprint, null);
        else assert.equal(result.reply, summary);
      }
    });
    await t.test("a changed restaurant summary replaces the menu and needs a fresh confirmation", async () => {
      setup("restaurant"); restaurantRequote = true;
      const first = await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(first.tool, "deterministic:restaurant_request_requote");
      assert.equal(state.pendingQuoteFingerprint, "FAKE-updated");
      history.unshift({ direction: "IN", body: "1" });
      history.unshift({ direction: "OUT", body: first.reply });
      restaurantRequote = false;
      await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
      assert.deepEqual(calls[1].consent, { fingerprint: "FAKE-updated" });
    });
    await t.test("short text confirmations remain supported alongside numbers", async () => {
      for (const text of ["ยืนยันค่ะ", "เอาเลย", "โอเค", "confirm", "yes"]) {
        setup("restaurant");
        await runPipeline(text, "web", "FAKE-shop", "FAKE-customer");
        assert.equal(calls.length, 1, text);
        assert.deepEqual(calls[0].consent, { fingerprint: "FAKE-fingerprint" });
      }
    });
    await t.test("a failed deterministic requote save does not show an unusable menu", async () => {
      setup(); retailRequoteFailure = true;
      try {
        const result = await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
        assert.equal(calls.length, 1);
        assert.match(result.reply, /ยังบันทึกสรุปไม่ได้/);
        assert.doesNotMatch(result.reply, /1\. ยืนยัน/);
        assert.equal(state.pendingQuoteFingerprint, "FAKE-fingerprint");
      } finally {
        retailRequoteFailure = false;
      }
    });
    await t.test("stale and expired menus never reach quantity parsing or business tools", async () => {
      for (const reason of ["stale", "expired"]) for (const answer of ["1", "ยืนยัน", "confirm"]) {
        setup();
        if (reason === "stale") history.unshift({ direction: "OUT", body: "FAKE newer staff reply" });
        else state.pendingConversationChoice.expiresAt = 1;
        const result = await runPipeline(answer, "web", "FAKE-shop", "FAKE-customer");
        assert.equal(result.tool, "deterministic:choice_expired");
        assert.equal(calls.length, 0);
        assert.equal(state.pendingConversationChoice, null);
      }
    });
    await t.test("a menu snapshot can be claimed only once and a changed snapshot cannot be claimed", async () => {
      const { consumeAiConversationChoice } = await import("../../apps/web/lib/bms/inbox.ts");
      setup();
      const original = structuredClone(state.pendingConversationChoice);
      assert.equal(await consumeAiConversationChoice("FAKE-shop", "FAKE-conversation", original), true);
      assert.equal(await consumeAiConversationChoice("FAKE-shop", "FAKE-conversation", original), false);
      setup();
      assert.equal(await consumeAiConversationChoice("FAKE-shop", "FAKE-conversation", original), false);
      assert.equal(calls.length, 0);
    });
    await t.test("a menu after a separate staff message remains the latest actual message", async () => {
      setup("restaurant");
      history.splice(1, 0, { direction: "OUT", body: "FAKE previous staff reply" });
      await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(calls.length, 1);
    });
    await t.test("generic choices cannot borrow an order confirmation", async () => {
      setup();
      const options = inputChoiceOptions(["ยืนยัน", "กลับ"]);
      const prompt = renderConversationChoices("FAKE question", options);
      state.pendingConversationChoice = createPendingConversationChoice({ kind: "INPUT_SELECTION", prompt, options });
      history[0].body = prompt;
      await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].consent, undefined);
    });
    await t.test("failed persistence of an input choice stops before business tools", async () => {
      setup();
      const options = inputChoiceOptions(["ยืนยัน", "กลับ"]);
      const prompt = renderConversationChoices("FAKE question", options);
      state.pendingConversationChoice = createPendingConversationChoice({ kind: "INPUT_SELECTION", prompt, options });
      history[0].body = prompt; failState = true;
      const result = await runPipeline("1", "web", "FAKE-shop", "FAKE-customer");
      assert.equal(result.tool, "deterministic:choice_unavailable");
      assert.equal(calls.length, 0);
    });
    await t.test("ordinary choice tool validates its menu and never sets confirmation authority", async () => {
      const tool = ALL_TOOLS.find(tool => tool.name === "present_customer_choices")!;
      const ec: any = { tenantId: "FAKE", surface: "customer", actor: "ai:customer" };
      await tool.execute({ question: "Choose a branch", labels: ["FAKE north", "FAKE south"] }, ec);
      assert.deepEqual(ec.customerInputChoices.labels, ["FAKE north", "FAKE south"]);
      assert.equal(ec.customerConfirmedQuote, undefined);
      for (const labels of [["same", "same"], ["one"], ["one", "two\n3. hidden"], Array.from({length: 9}, (_,i) => String(i))]) {
        await assert.rejects(tool.execute({ question: "FAKE", labels }, ec));
      }
    });
    await t.test("pharmacy selection refuses a changed case, stage or question", async () => {
      const { runPharmacyIntakeTurn } = await import("../../apps/web/lib/bms/pharmacy/intake.ts");
      assessment = { id: "FAKE-case", tenant_id: "FAKE-shop", status: "COLLECTING_INFORMATION", consent_status: "GRANTED", current_question_key: "current", created_at: new Date(), updated_at: new Date() };
      const current: any = { stage: "ASKING", status: "COLLECTING_INFORMATION", caseId: "FAKE-case" };
      for (const context of [
        { caseId: "FAKE-other", stage: "ASKING", questionKey: "current" },
        { caseId: "FAKE-case", stage: "PENDING_CONFIRMATION" },
        { caseId: "FAKE-case", stage: "ASKING", questionKey: "old" },
      ]) {
        const result = await runPharmacyIntakeTurn("FAKE-shop", "web", "FAKE-customer", "FAKE-conversation", "ไม่มี", current, context);
        assert.match(result.reply, /ขั้นตอนนี้เปลี่ยนแล้ว/);
      }
      assessment = { ...assessment, status: "DRAFT", consent_status: "PENDING", expires_at: new Date(Date.now() + 60_000) };
      const consent = await runPharmacyIntakeTurn("FAKE-shop", "web", "FAKE-customer", "FAKE-conversation", "ขอคำถามใหม่", { stage: "AWAITING_CONSENT", caseId: "FAKE-case" });
      assert.deepEqual(consent.choice?.options.map(option => option.replyText), ["ยินยอม", "ไม่ยินยอม"]);
      assert.equal(consent.choice?.context.caseId, "FAKE-case");
      assessment = { ...assessment, status: "PENDING_CONFIRMATION", consent_status: "GRANTED", customer_confirmation_summary: { symptomGroup: "FAKE symptom", lines: [{ label: "FAKE field", valueText: "FAKE value" }] } };
      const summary = await runPharmacyIntakeTurn("FAKE-shop", "web", "FAKE-customer", "FAKE-conversation", "ขอสรุปใหม่", { stage: "PENDING_CONFIRMATION", status: "PENDING_CONFIRMATION", caseId: "FAKE-case" });
      assert.deepEqual(summary.choice?.options.map(option => option.replyText), ["ข้อมูลถูกต้อง", "ขอแก้ไข", "ยกเลิก"]);
      assert.match(summary.reply, /FAKE value/);
      assessment = null;
    });
    await t.test("approved pharmacy checkout requires its current menu and never accepts a negative substring", async () => {
      const options = inputChoiceOptions(["ยืนยันสั่งซื้อ", "ยังไม่สั่งซื้อ"]);
      const prompt = renderConversationChoices("FAKE approved checkout", options);
      assessment = { id: "FAKE-case", checkout_order_draft: { status: "AWAITING_CUSTOMER_CONFIRMATION",
        items: [{ sku: "FAKE-SKU", size: "M", qty: 2, unitPrice: 50, productName: "FAKE item" }] } };
      try {
        for (const scenario of ["no-menu", "expired", "changed-case", "decline", "negative"]) {
          setup(); state = {};
          history = [{ direction: "OUT", body: prompt }];
          if (scenario !== "no-menu") state.pendingConversationChoice = createPendingConversationChoice({
            kind: "PHARMACY_CHECKOUT", prompt, options,
            context: { caseId: scenario === "changed-case" ? "FAKE-other" : "FAKE-case", stage: "APPROVED" },
          });
          if (scenario === "expired") state.pendingConversationChoice.expiresAt = 1;
          const result = await runPipeline(scenario === "decline" ? "2" : scenario === "negative" ? "ยังไม่ยืนยันสั่งซื้อ" : "ยืนยันสั่งซื้อ", "web", "FAKE-shop", "FAKE-customer");
          const expected: Record<string, string> = { "no-menu": "pharmacy:checkout_confirmation_required",
            expired: "deterministic:choice_expired", "changed-case": "pharmacy:checkout_choice_changed", decline: "pharmacy:checkout_declined" };
          if (expected[scenario]) assert.equal(result.tool, expected[scenario]);
          assert.notEqual(result.tool, "pharmacy:approved_checkout_create_order");
          assert.equal(calls.length, 0);
        }
      } finally { assessment = null; }
    });
    await t.test("Lab carries numbered confirmation through its existing JSON session", async () => {
      const { runPharmacyTestHarness } = await import("../../apps/web/lib/bms/pharmacy/testHarness.ts");
      const options = inputChoiceOptions(["ข้อมูลถูกต้อง", "ขอแก้ไข", "ยกเลิก"]);
      const prompt = renderConversationChoices("FAKE summary", options);
      const result = await runPharmacyTestHarness("FAKE-shop", "3", { phase: "PENDING_CONFIRMATION", answers: {
        __conversation_prompt: prompt,
        __conversation_choice: JSON.stringify(createPendingConversationChoice({ kind: "INPUT_SELECTION", prompt, options })),
      } });
      assert.equal(result.session.phase, "NONE");
    });
    await t.test("Lab refuses changed question context and expired product menus even on the next reply", async () => {
      const { runPharmacyTestHarness } = await import("../../apps/web/lib/bms/pharmacy/testHarness.ts");
      const options = inputChoiceOptions(["FAKE-A", "FAKE-B"]);
      const prompt = renderConversationChoices("FAKE products", options);
      for (const reason of ["question", "expired", "malformed"]) {
        const pending = createPendingConversationChoice({ kind: "INPUT_SELECTION", prompt, options,
          context: { caseId: "lab", stage: "PRODUCT_PURCHASE", questionKey: "old" } });
        if (reason === "expired") pending.expiresAt = 1;
        const first = await runPharmacyTestHarness("FAKE-shop", "1", { phase: "PRODUCT_PURCHASE", currentQuestionKey: "new", answers: {
          __product_options: JSON.stringify([{ sku: "FAKE-A", name: "FAKE A" }]),
          __conversation_prompt: prompt,
          __conversation_choice: reason === "malformed" ? "{" : JSON.stringify(pending),
        } });
        assert.match(first.reply, /เปลี่ยนแล้ว|ไม่ได้ใช้งาน|ไม่มีเมนู/);
        const second = await runPharmacyTestHarness("FAKE-shop", "1", first.session);
        assert.match(second.reply, /ไม่มีเมนู/);
        assert.equal(second.session.answers?.__product_cart, undefined);
      }
    });
    await t.test("Lab variant pagination retains exact numeric sizes and requested quantity", async () => {
      const { runPharmacyTestHarness, __pharmacyProductCartTest } = await import("../../apps/web/lib/bms/pharmacy/testHarness.ts");
      const entries = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), replyText: `ขนาด ${i + 1}` }));
      const options = [{ code: "9", value: "INPUT" as const, label: "เพิ่มเติม", replyText: "__choices_next:8" }];
      const prompt = renderConversationChoices("FAKE sizes", options);
      const result = await runPharmacyTestHarness("FAKE-shop", "9", { phase: "PRODUCT_PURCHASE", answers: {
        __product_qty: 7,
        __product_size_options: JSON.stringify(entries.map(entry => ({ size: entry.label, available: 20 }))),
        __conversation_entries: JSON.stringify({ question: "FAKE sizes", entries }),
        __conversation_prompt: prompt,
        __conversation_choice: JSON.stringify(createPendingConversationChoice({ kind: "INPUT_SELECTION", prompt, options,
          context: { caseId: "lab", stage: "PRODUCT_PURCHASE", questionKey: null } })),
      } });
      const pending = JSON.parse(String(result.session.answers?.__conversation_choice));
      assert.equal(pending.options[0].replyText, "ขนาด 9");
      assert.equal(pending.options.at(-1).replyText, "__choices_next:0");
      assert.equal(result.session.answers?.__product_qty, 7);
      assert.equal(__pharmacyProductCartTest.resolveProductSizeOption(result.session.answers!, pending.options[0].replyText)?.size, "9");
      const firstPage = await runPharmacyTestHarness("FAKE-shop", "9", result.session);
      assert.equal(JSON.parse(String(firstPage.session.answers?.__conversation_choice)).options[0].replyText, "ขนาด 1");
    });
    assert.equal(network.mock.callCount(), 0);
  } finally {
    globals.__bmsPostgresPool = previousPool;
    for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test("sequential product choices retain every line and require a separate basket confirmation", () => {
  const pending = { version: 1 as const, lines: ["A", "B"].map(lineCode => ({
    lineCode, product: `FAKE-${lineCode}`, size: "M", qty: lineCode === "A" ? 2 : 3, unit: "box",
    candidates: [1, 2].map(n => ({ choiceCode: `${lineCode}${n}`, sku: `FAKE-${lineCode}${n}`, name: `FAKE ${lineCode}${n}` })),
  })) };
  const first = catalogSelectionMenu(pending)!;
  assert.deepEqual(first.options.map(option => option.code), ["1", "2"]);
  const next = advanceCatalogSelection(pending, first.options[1].replyText!)!;
  assert.deepEqual(next.lines.map(line => line.qty), [2, 3]);
  const second = catalogSelectionMenu(next)!;
  assert.equal(second.options[0].replyText, "B1");
  const complete = advanceCatalogSelection(next, second.options[0].replyText!)!;
  assert.equal(catalogSelectionMenu(complete), null);
  assert.deepEqual(parseCatalogChoiceSelection(complete, "B1"), { kind: "complete", selected: [pending.lines[0].candidates[1], pending.lines[1].candidates[0]] });
  assert.equal(advanceCatalogSelection(pending, "B1"), null);
});
