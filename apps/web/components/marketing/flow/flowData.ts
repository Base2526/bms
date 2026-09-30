import type { FlowEdge, FlowNode, FlowScenario, ShopScenario } from "./flowTypes";

export const FLOW_STATUS_UPDATED_AT = "2026-09-29";

const allShops: ShopScenario[] = ["all", "retail", "restaurant", "boardgame", "pharmacy"];

export const flowNodes: FlowNode[] = [
  {
    id: "ch-line", group: "chat", icon: "chat", labelKey: "bmsFlow.nodes.chLine.label",
    shortKey: "bmsFlow.nodes.chLine.short", detail: { whatKey: "bmsFlow.nodes.chLine.what", noteKey: "bmsFlow.nodes.chLine.note" },
    status: "config", scenarios: ["all", "retail", "restaurant", "pharmacy"], compact: true,
  },
  {
    id: "ch-facebook", group: "chat", icon: "chat", labelKey: "bmsFlow.nodes.chFacebook.label",
    shortKey: "bmsFlow.nodes.chFacebook.short", detail: { whatKey: "bmsFlow.nodes.chFacebook.what", noteKey: "bmsFlow.nodes.chFacebook.note" },
    status: "config", scenarios: ["all", "retail", "restaurant"], compact: true,
  },
  {
    id: "ch-instagram", group: "chat", icon: "chat", labelKey: "bmsFlow.nodes.chInstagram.label",
    shortKey: "bmsFlow.nodes.chInstagram.short", detail: { whatKey: "bmsFlow.nodes.chInstagram.what", noteKey: "bmsFlow.nodes.chInstagram.note" },
    status: "config", scenarios: ["all", "retail", "restaurant"], compact: true,
  },
  {
    id: "ch-tiktok", group: "chat", icon: "phone", labelKey: "bmsFlow.nodes.chTiktok.label",
    shortKey: "bmsFlow.nodes.chTiktok.short", detail: { whatKey: "bmsFlow.nodes.chTiktok.what", noteKey: "bmsFlow.nodes.chTiktok.note" },
    status: "config", scenarios: ["all", "retail"], compact: true,
  },
  {
    id: "ch-web", group: "chat", icon: "globe", labelKey: "bmsFlow.nodes.chWeb.label",
    shortKey: "bmsFlow.nodes.chWeb.short", detail: { whatKey: "bmsFlow.nodes.chWeb.what", noteKey: "bmsFlow.nodes.chWeb.note" },
    status: "config", scenarios: allShops, compact: true,
  },
  {
    id: "in-qr", group: "orderIntake", icon: "qr", labelKey: "bmsFlow.nodes.inQr.label",
    shortKey: "bmsFlow.nodes.inQr.short", detail: { whatKey: "bmsFlow.nodes.inQr.what", exampleKey: "bmsFlow.nodes.inQr.example", noteKey: "bmsFlow.nodes.inQr.note" },
    status: "ready", scenarios: ["all", "restaurant"], compact: true,
  },
  {
    id: "in-grabfood", group: "orderIntake", icon: "bag", labelKey: "bmsFlow.nodes.inGrabfood.label",
    shortKey: "bmsFlow.nodes.inGrabfood.short", detail: { whatKey: "bmsFlow.nodes.inGrabfood.what", noteKey: "bmsFlow.nodes.inGrabfood.note" },
    status: "pilot", scenarios: ["all", "restaurant"], compact: true,
  },
  {
    id: "in-lineman", group: "orderIntake", icon: "bag", labelKey: "bmsFlow.nodes.inLineman.label",
    shortKey: "bmsFlow.nodes.inLineman.short", detail: { whatKey: "bmsFlow.nodes.inLineman.what", noteKey: "bmsFlow.nodes.inLineman.note" },
    status: "pilot", scenarios: ["all", "restaurant"], compact: true,
  },
  {
    id: "intake-accept", group: "orderIntake", icon: "ucheck", labelKey: "bmsFlow.nodes.intakeAccept.label",
    shortKey: "bmsFlow.nodes.intakeAccept.short", detail: { whatKey: "bmsFlow.nodes.intakeAccept.what" },
    status: "ready", scenarios: ["all", "restaurant"], compact: true,
  },
  {
    id: "pos-web", group: "pos", icon: "globe", labelKey: "bmsFlow.nodes.posWeb.label",
    shortKey: "bmsFlow.nodes.posWeb.short", detail: { whatKey: "bmsFlow.nodes.posWeb.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "pos-desktop", group: "pos", icon: "monitor", labelKey: "bmsFlow.nodes.posDesktop.label",
    shortKey: "bmsFlow.nodes.posDesktop.short", detail: { whatKey: "bmsFlow.nodes.posDesktop.what", noteKey: "bmsFlow.nodes.posDesktop.note" },
    status: "pilot", scenarios: allShops, compact: true,
  },
  {
    id: "pos-mobile", group: "pos", icon: "phone", labelKey: "bmsFlow.nodes.posMobile.label",
    shortKey: "bmsFlow.nodes.posMobile.short", detail: { whatKey: "bmsFlow.nodes.posMobile.what", noteKey: "bmsFlow.nodes.posMobile.note" },
    status: "pilot", scenarios: allShops, compact: true,
  },
  {
    id: "ai-inbox", group: "core", icon: "spark", labelKey: "bmsFlow.nodes.aiInbox.label",
    shortKey: "bmsFlow.nodes.aiInbox.short", detail: { whatKey: "bmsFlow.nodes.aiInbox.what" },
    status: "ready", scenarios: ["all", "retail", "restaurant", "pharmacy"], compact: true,
  },
  {
    id: "cloud-pos", group: "core", icon: "store", labelKey: "bmsFlow.nodes.cloudPos.label",
    shortKey: "bmsFlow.nodes.cloudPos.short", detail: { whatKey: "bmsFlow.nodes.cloudPos.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "confirm", group: "core", icon: "ucheck", labelKey: "bmsFlow.nodes.confirm.label",
    shortKey: "bmsFlow.nodes.confirm.short", detail: { whatKey: "bmsFlow.nodes.confirm.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "bms-core", group: "core", icon: "server", labelKey: "bmsFlow.nodes.bmsCore.label",
    shortKey: "bmsFlow.nodes.bmsCore.short", detail: { whatKey: "bmsFlow.nodes.bmsCore.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "m-crm", group: "module", icon: "users", labelKey: "bmsFlow.nodes.mCrm.label",
    shortKey: "bmsFlow.nodes.mCrm.short", detail: { whatKey: "bmsFlow.nodes.mCrm.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "m-loyalty", group: "module", icon: "gift", labelKey: "bmsFlow.nodes.mLoyalty.label",
    shortKey: "bmsFlow.nodes.mLoyalty.short", detail: { whatKey: "bmsFlow.nodes.mLoyalty.what" },
    status: "ready", scenarios: ["all", "retail", "restaurant", "boardgame"], compact: false,
  },
  {
    id: "m-stock", group: "module", icon: "box", labelKey: "bmsFlow.nodes.mStock.label",
    shortKey: "bmsFlow.nodes.mStock.short", detail: { whatKey: "bmsFlow.nodes.mStock.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "m-payment", group: "module", icon: "card", labelKey: "bmsFlow.nodes.mPayment.label",
    shortKey: "bmsFlow.nodes.mPayment.short", detail: { whatKey: "bmsFlow.nodes.mPayment.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "m-tax", group: "module", icon: "doc", labelKey: "bmsFlow.nodes.mTax.label",
    shortKey: "bmsFlow.nodes.mTax.short", detail: { whatKey: "bmsFlow.nodes.mTax.what", noteKey: "bmsFlow.nodes.mTax.note" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "m-purchase", group: "module", icon: "cart", labelKey: "bmsFlow.nodes.mPurchase.label",
    shortKey: "bmsFlow.nodes.mPurchase.short", detail: { whatKey: "bmsFlow.nodes.mPurchase.what" },
    status: "ready", scenarios: ["all", "retail", "restaurant", "pharmacy"], compact: false,
  },
  {
    id: "o-kds", group: "output", icon: "chef", labelKey: "bmsFlow.nodes.oKds.label",
    shortKey: "bmsFlow.nodes.oKds.short", detail: { whatKey: "bmsFlow.nodes.oKds.what" },
    status: "ready", scenarios: ["all", "restaurant"], compact: true,
  },
  {
    id: "o-shipping", group: "output", icon: "truck", labelKey: "bmsFlow.nodes.oShipping.label",
    shortKey: "bmsFlow.nodes.oShipping.short", detail: { whatKey: "bmsFlow.nodes.oShipping.what", noteKey: "bmsFlow.nodes.oShipping.note" },
    status: "ready", scenarios: ["all", "retail", "pharmacy"], compact: false,
  },
  {
    id: "o-live", group: "output", icon: "pulse", labelKey: "bmsFlow.nodes.oLive.label",
    shortKey: "bmsFlow.nodes.oLive.short", detail: { whatKey: "bmsFlow.nodes.oLive.what" },
    status: "ready", scenarios: allShops, compact: true, href: "/live-dashboard",
  },
  {
    id: "o-reports", group: "output", icon: "chart", labelKey: "bmsFlow.nodes.oReports.label",
    shortKey: "bmsFlow.nodes.oReports.short", detail: { whatKey: "bmsFlow.nodes.oReports.what" },
    status: "ready", scenarios: allShops, compact: false,
  },
  {
    id: "o-action", group: "output", icon: "target", labelKey: "bmsFlow.nodes.oAction.label",
    shortKey: "bmsFlow.nodes.oAction.short", detail: { whatKey: "bmsFlow.nodes.oAction.what" },
    status: "ready", scenarios: allShops, compact: true,
  },
  {
    id: "loop-retention", group: "loop", icon: "loop", labelKey: "bmsFlow.nodes.loopRetention.label",
    shortKey: "bmsFlow.nodes.loopRetention.short", detail: { whatKey: "bmsFlow.nodes.loopRetention.what" },
    status: "ready", scenarios: ["all", "retail", "restaurant", "boardgame"], compact: true,
  },
];

export const flowEdges: FlowEdge[] = [
  ...["ch-line", "ch-facebook", "ch-instagram", "ch-tiktok", "ch-web"].map((from) => ({ from, to: "ai-inbox", kind: "main" as const })),
  ...["in-qr", "in-grabfood", "in-lineman"].map((from) => ({ from, to: "intake-accept", kind: "main" as const })),
  { from: "intake-accept", to: "cloud-pos", kind: "handoff" },
  ...["pos-web", "pos-desktop", "pos-mobile"].map((from) => ({ from, to: "cloud-pos", kind: "main" as const })),
  { from: "ai-inbox", to: "confirm", kind: "main" },
  { from: "cloud-pos", to: "confirm", kind: "main" },
  { from: "confirm", to: "bms-core", kind: "main" },
  ...["m-crm", "m-loyalty", "m-stock", "m-payment", "m-tax", "m-purchase"].map((to) => ({ from: "bms-core", to, kind: "main" as const })),
  ...["o-kds", "o-shipping", "o-live", "o-reports", "o-action"].map((to) => ({ from: "bms-core", to, kind: "main" as const })),
  { from: "o-action", to: "loop-retention", kind: "main" },
  { from: "loop-retention", to: "ch-line", kind: "loop", labelKey: "bmsFlow.edge.retention" },
];

export const flowScenarios: FlowScenario[] = [
  {
    id: "retail", labelKey: "bmsFlow.scenarios.retail.label", steps: [
      ["ch-line", "bmsFlow.scenarios.retail.step1"], ["ai-inbox", "bmsFlow.scenarios.retail.step2"],
      ["confirm", "bmsFlow.scenarios.retail.step3"], ["bms-core", "bmsFlow.scenarios.retail.step4"],
      ["m-payment", "bmsFlow.scenarios.retail.step5"], ["o-shipping", "bmsFlow.scenarios.retail.step6"],
      ["o-live", "bmsFlow.scenarios.retail.step7"],
    ].map(([nodeId, captionKey]) => ({ nodeId, captionKey: captionKey as `bmsFlow.${string}` })),
  },
  {
    id: "restaurant", labelKey: "bmsFlow.scenarios.restaurant.label", steps: [
      ["in-qr", "bmsFlow.scenarios.restaurant.step1"], ["intake-accept", "bmsFlow.scenarios.restaurant.step2"],
      ["cloud-pos", "bmsFlow.scenarios.restaurant.step3"], ["o-kds", "bmsFlow.scenarios.restaurant.step4"],
      ["m-payment", "bmsFlow.scenarios.restaurant.step5"], ["m-tax", "bmsFlow.scenarios.restaurant.step6"],
      ["o-reports", "bmsFlow.scenarios.restaurant.step7"],
    ].map(([nodeId, captionKey]) => ({ nodeId, captionKey: captionKey as `bmsFlow.${string}` })),
  },
  {
    id: "boardgame", labelKey: "bmsFlow.scenarios.boardgame.label", steps: [
      ["pos-web", "bmsFlow.scenarios.boardgame.step1"], ["cloud-pos", "bmsFlow.scenarios.boardgame.step2"],
      ["bms-core", "bmsFlow.scenarios.boardgame.step3"], ["m-loyalty", "bmsFlow.scenarios.boardgame.step4"],
      ["o-live", "bmsFlow.scenarios.boardgame.step5"],
    ].map(([nodeId, captionKey]) => ({ nodeId, captionKey: captionKey as `bmsFlow.${string}` })),
  },
  {
    id: "pharmacy", labelKey: "bmsFlow.scenarios.pharmacy.label", steps: [
      ["ch-line", "bmsFlow.scenarios.pharmacy.step1"], ["ai-inbox", "bmsFlow.scenarios.pharmacy.step2"],
      ["confirm", "bmsFlow.scenarios.pharmacy.step3"], ["cloud-pos", "bmsFlow.scenarios.pharmacy.step4"],
      ["bms-core", "bmsFlow.scenarios.pharmacy.step5"], ["m-stock", "bmsFlow.scenarios.pharmacy.step6"],
    ].map(([nodeId, captionKey]) => ({ nodeId, captionKey: captionKey as `bmsFlow.${string}` })),
  },
];

export const realFlowRoutes = ["/live-dashboard", "/retail-local", "/roadmap"] as const;

