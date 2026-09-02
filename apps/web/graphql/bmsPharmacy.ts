// GraphQL resolver — AI Pharmacy Intake Assistant
// permission model: pharmacy.assessment.{read,assign,request_more_information,
// review,approve,reject}, pharmacy.protocol.manage, pharmacy.audit.read
// (lib/bms/permissions.ts) — approve/reject/refer ALSO check
// users.is_licensed_pharmacist unconditionally inside the service layer
// (lib/bms/pharmacy/assessments.ts); requirePermission() here is not the
// only gate for those three.
import { GraphQLError } from "graphql/error";
import { requirePermission } from "@/lib/bms/permissions";
import {
  PHARMACY_EVIDENCE_KINDS,
  addClinicalEvidence,
  deleteClinicalEvidence,
  listClinicalEvidence,
  type PharmacyEvidenceKind,
} from "@/lib/bms/pharmacy/clinicalEvidence";
import { requireAuth } from "@/lib/auth";
import { getTenantId } from "@/lib/bms/tenant";
import { query } from "@/lib/db";
import { audit } from "@/lib/bms/audit";
import { isPharmacyAiEnabled, isPharmacyIntakeEnabled } from "@/lib/bms/pharmacy/config";
import { listPharmacistCounterAuthorizations } from "@/lib/bms/pharmacy/counterAuthorizations";
import { AnthropicCompatiblePharmacyIntakeAI, filterMedicationSuggestionsAgainstAllergies } from "@/lib/bms/pharmacy/ai";
import {
  approveAssessment,
  assignPharmacist,
  editAssessmentSummary,
  editPharmacistDecisionNotes,
  escalateToEmergency,
  getAssessment,
  getAssessmentConversationHistory,
  listAssessments,
  recordConsent,
  recordMedicationSuggestions,
  referToDoctor,
  rejectAssessment,
  requestMoreInformation,
  softDeleteAssessment,
  startReview,
} from "@/lib/bms/pharmacy/assessments";
import {
  getPharmacyProtocol,
  listPharmacyProtocols,
  reviewPharmacyProtocol,
  setPharmacyProtocolEnabled,
  submitPharmacyProtocolForReview,
  upsertPharmacyProtocol,
  type UpsertPharmacyProtocolInput,
} from "@/lib/bms/pharmacy/protocols";
import { applyManualAnswers } from "@/lib/bms/pharmacy/intake";
import { seedPharmacyQueueDemo } from "@/lib/bms/pharmacy/demo";
import { listSellableProducts } from "@/lib/bms/products";
import {
  listPharmacyProductPolicies,
  listPharmacyProductPoliciesPage,
  reviewPharmacyProductPolicy,
  submitPharmacyProductPolicyForReview,
  upsertPharmacyProductPolicyDraft,
  type UpsertPharmacyProductPolicyInput,
} from "@/lib/bms/pharmacy/productPolicy";

const PHARMACY_SEARCH_ALIAS_GROUPS: Array<{ match: RegExp; aliases: string[] }> = [
  {
    match: /\b(paracetamol|acetaminophen)\b|พารา|พาราเซตามอล/i,
    aliases: ["paracetamol", "acetaminophen", "พาราเซตามอล", "พารา", "ลดไข้", "ยาน้ำพารา"],
  },
  {
    match: /\b(ibuprofen)\b|ไอบูโพรเฟน/i,
    aliases: ["ibuprofen", "ไอบูโพรเฟน", "ยาน้ำไอบูโพรเฟน", "ลดไข้เด็ก"],
  },
  {
    match: /\b(oral rehydration salts|ors)\b|เกลือแร่/i,
    aliases: ["ors", "oral rehydration salts", "เกลือแร่", "ผงเกลือแร่"],
  },
  {
    match: /\b(loratadine)\b|ลอราทาดีน/i,
    aliases: ["loratadine", "ลอราทาดีน", "ยาแก้แพ้", "ภูมิแพ้"],
  },
  {
    match: /\b(domperidone)\b|โดมเพอริโดน/i,
    aliases: ["domperidone", "โดมเพอริโดน", "คลื่นไส้", "ท้องอืด"],
  },
  {
    match: /\b(cough|cough syrup)\b|ยาแก้ไอ|ขับเสมหะ|มะขามป้อม/i,
    aliases: ["cough syrup", "ยาแก้ไอ", "ขับเสมหะ", "มะขามป้อม", "ไอ"],
  },
];

function buildPharmacySearchTerms(suggestion: { drugName?: string; strength?: string; dosageInstruction?: string }) {
  const base = [suggestion.drugName, suggestion.strength]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const out = new Set<string>(base);
  const haystack = [suggestion.drugName, suggestion.strength, suggestion.dosageInstruction]
    .map((value) => String(value || ""))
    .join(" ");
  for (const group of PHARMACY_SEARCH_ALIAS_GROUPS) {
    if (group.match.test(haystack)) {
      for (const alias of group.aliases) out.add(alias);
    }
  }
  return Array.from(out).slice(0, 8);
}

function requireIntakeEnabled() {
  if (!isPharmacyIntakeEnabled()) {
    throw new GraphQLError("Pharmacy Intake ยังไม่ได้เปิดใช้งาน (PHARMACY_INTAKE_ENABLED=false)", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function actorId(ctx: any): string {
  const id = requireAuth(ctx).author_id;
  if (!id) throw new GraphQLError("Unauthenticated", { extensions: { code: "UNAUTHENTICATED" } });
  return String(id);
}

/**
 * Granting/revoking a pharmacist license is a fact about a human, not a
 * BMS operational permission — gated the same way role assignment is,
 * Administrator only. Deliberately a standalone check here (not a new
 * BMS_PERMISSIONS entry) so it can never be granted away to a non-admin
 * role, and deliberately not touching the shared `users`/`upsertUser`
 * resolver at all — this is fully additive.
 */
function requireAdministrator(ctx: any) {
  if (ctx?.admin?.role !== "Administrator") {
    throw new GraphQLError("เฉพาะ Administrator เท่านั้นที่กำหนดสถานะเภสัชกรได้", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}

/** GraphQL `String!` only guarantees non-null, not non-empty — every free-text
 *  field that drives a real decision (reason/summary) is re-checked here so
 *  a raw GraphQL call (bypassing the UI's disabled-button convenience) can't
 *  record an empty reason. */
function requireNonEmpty(value: string, label: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    throw new GraphQLError(`ต้องระบุ "${label}"`, { extensions: { code: "BAD_USER_INPUT" } });
  }
  return trimmed;
}

function decisionResultToGraphQLError(result: { status: string; [k: string]: unknown }): never {
  const messages: Record<string, string> = {
    NOT_FOUND: "ไม่พบเคสนี้",
    INVALID_STATE: `สถานะเคสไม่ตรง (ปัจจุบัน: ${result.current})`,
    STALE_VERSION: "ข้อมูลถูกแก้ไขไปแล้วโดยคนอื่น กรุณาโหลดใหม่",
    NOT_A_LICENSED_PHARMACIST: "บัญชีนี้ไม่ได้ระบุว่าเป็นเภสัชกรที่มีใบประกอบวิชาชีพ",
    EXPIRED_NEEDS_REEVALUATION: "เคสหมดอายุแล้ว ต้องเปิดประเมินใหม่ก่อนอนุมัติ",
    CUSTOMER_CONFIRMATION_REQUIRED: "ลูกค้ายังไม่ได้ยืนยันสรุปข้อมูล และยังไม่มีการกรอกข้อมูลโดยเภสัชกรเพื่อใช้เส้นทาง manual override",
    PRODUCT_POLICY_BLOCKED: `รายการสินค้ายังไม่ผ่าน Product Policy: ${(result.fields as string[] | undefined)?.join(", ") ?? ""}`,
    MISSING_REQUIRED_FIELDS: `ข้อมูลยังไม่ครบ: ${(result.fields as string[] | undefined)?.join(", ") ?? ""}`,
  };
  throw new GraphQLError(messages[result.status] || "ดำเนินการไม่สำเร็จ", {
    extensions: { code: "BAD_USER_INPUT", pharmacyStatus: result.status },
  });
}

// 9.51: เคสหน้าร้านกับเคสออนไลน์ต้องเลือกยาจากคนละชุด
// ยาที่ร้านไม่ได้เปิดขายออนไลน์ต้องไม่โผล่ในตัวเลือกของเคสออนไลน์ ไม่งั้นเภสัชกรอนุมัติ
// ตะกร้าที่ createOrder ปฏิเสธทีหลัง (ต้องมี ONLINE_ORDER) = ใบอนุมัติที่ใช้จริงไม่ได้
// และยาที่ขายได้เฉพาะหน้าร้านต้องยังอยู่ในตัวเลือกของเคสจากเครื่องขาย ไม่งั้นเคาน์เตอร์
// จ่ายยาที่เพิ่งซักถามไปแล้วไม่ได้เลย
// ช่องทางอ่านจาก `channel_id` ไม่ใช่ `complaint.sourceMeta` (กฎเดียวกับ approveAssessment)
function catalogSurfaceForChannel(channelId: string | null | undefined): "RETAIL_POS" | "CUSTOMER_AI" {
  return channelId === "pos" ? "RETAIL_POS" : "CUSTOMER_AI";
}

async function assessmentCatalogSurface(
  tenantId: string,
  assessmentId: string | null
): Promise<"RETAIL_POS" | "CUSTOMER_AI"> {
  if (!assessmentId) return "CUSTOMER_AI";
  const assessment = await getAssessment(tenantId, assessmentId);
  return catalogSurfaceForChannel(assessment?.channelId);
}

export const bmsPharmacyResolvers = {
  Query: {
    async bmsPharmacyAssessments(
      _p: unknown,
      args: {
        status?: string;
        riskLevel?: string;
        assignedPharmacistId?: string;
        channelId?: string;
        createdAfter?: string;
        limit?: number;
        offset?: number;
      },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.assessment.read");
      return listAssessments(getTenantId(ctx), args);
    },
    async bmsPharmacyAssessment(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "pharmacy.assessment.read");
      return getAssessment(getTenantId(ctx), args.id);
    },
    // สิทธิ์แคบกว่าตัวเคส (pharmacy.evidence.read seed ให้ Pharmacist เท่านั้น
    // + Administrator ที่เป็น super) — Manager อ่านเคสได้แต่ดูใบสั่งยาไม่ได้
    async bmsPharmacyClinicalEvidence(_p: unknown, args: { assessmentId: string }, ctx: any) {
      await requirePermission(ctx, "pharmacy.evidence.read");
      return listClinicalEvidence(getTenantId(ctx), args.assessmentId);
    },
    async bmsPharmacyAssessmentConversationHistory(
      _p: unknown,
      args: { assessmentId: string; limit?: number },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.assessment.read");
      const limit = Math.min(Math.max(args.limit ?? 100, 1), 300);
      return getAssessmentConversationHistory(getTenantId(ctx), args.assessmentId, limit);
    },
    /**
     * บันทึกการจ่ายยาที่เภสัชกรอนุมัติที่เคาน์เตอร์ (9.29)
     *
     * `pharmacy.audit.read` (Pharmacist + Manager) — เกณฑ์เดียวกับ audit timeline
     * ของเคส: นี่คือร่องรอยว่าใครปล่อยยาออกจากร้าน ไม่ใช่ข้อมูลคลินิกของคนไข้
     * · ไม่ต้อง seed permission ใหม่
     */
    async bmsPharmacistCounterAuthorizations(
      _p: unknown,
      args: { from?: string | null; to?: string | null; limit?: number | null; offset?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.audit.read");
      return listPharmacistCounterAuthorizations(getTenantId(ctx), {
        from: args.from ?? null,
        to: args.to ?? null,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      });
    },
    async bmsPharmacyAssessmentEvents(_p: unknown, args: { assessmentId: string; limit?: number }, ctx: any) {
      await requirePermission(ctx, "pharmacy.audit.read");
      const limit = Math.min(Math.max(args.limit ?? 100, 1), 300);
      const res = await query(
        `SELECT * FROM bms_pharmacy_assessment_events
          WHERE tenant_id = $1 AND assessment_id = $2
          ORDER BY created_at DESC LIMIT $3`,
        [getTenantId(ctx), args.assessmentId, limit]
      );
      return res.rows.map((r: any) => ({
        id: String(r.id),
        assessmentId: r.assessment_id,
        actor: r.actor,
        action: r.action,
        previousState: r.previous_state,
        nextState: r.next_state,
        meta: r.meta ?? {},
        createdAt: new Date(r.created_at).toISOString(),
      }));
    },
    async bmsPharmacyCatalog(
      _p: unknown,
      args: { search?: string | null; limit?: number | null; assessmentId?: string | null },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.review");
      const { items } = await listSellableProducts(getTenantId(ctx), {
        search: args.search?.trim() || undefined,
        inStockOnly: true,
        sort: "relevance",
        limit: args.limit ?? 12,
        salesSurface: await assessmentCatalogSurface(getTenantId(ctx), args.assessmentId ?? null),
      });
      const policies = await listPharmacyProductPolicies(getTenantId(ctx));
      const policyBySku = new Map(policies.map((policy) => [policy.productSku, policy]));
      return items.map((item) => ({
        sku: item.sku,
        name: item.name,
        price: item.price,
        category: item.category,
        brand: item.brand,
        availableTotal: item.availableTotal,
        variants: item.availableSizes.filter((variant) => variant.available > 0),
        productType: policyBySku.get(item.sku)?.productType ?? "UNKNOWN",
        salePolicy: policyBySku.get(item.sku)?.salePolicy ?? "UNKNOWN",
        policyStatus: policyBySku.get(item.sku)?.status ?? "MISSING",
      }));
    },
    async bmsPharmacyProtocols(_p: unknown, _args: unknown, ctx: any) {
      await requirePermission(ctx, "pharmacy.assessment.read");
      return listPharmacyProtocols(getTenantId(ctx));
    },
    async bmsPharmacyProductPolicies(
      _p: unknown,
      args: { search?: string | null; limit?: number | null; offset?: number | null },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.assessment.read");
      return listPharmacyProductPoliciesPage(getTenantId(ctx), {
        search: args.search?.trim() || undefined,
        limit: args.limit ?? undefined,
        offset: args.offset ?? undefined,
      });
    },
    async bmsPharmacyProtocol(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      return getPharmacyProtocol(getTenantId(ctx), args.id);
    },
    async bmsPharmacyLicenseCandidates(_p: unknown, _a: unknown, ctx: any) {
      requireAdministrator(ctx);
      const res = await query(
        `SELECT id, name, email, is_licensed_pharmacist, pharmacist_license_no
           FROM users WHERE tenant_id = $1 ORDER BY name`,
        [getTenantId(ctx)]
      );
      return res.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        isLicensedPharmacist: r.is_licensed_pharmacist === true,
        pharmacistLicenseNo: r.pharmacist_license_no ?? null,
      }));
    },
  },
  Mutation: {
    // เภสัชกรบันทึกเลขอ้างอิงใบสั่งยา / คำแนะนำที่ให้ลูกค้า จากหน้าคิว
    // รูปภาพไม่ผ่าน GraphQL — อัปโหลดทาง REST (multipart) เท่านั้น
    async bmsPharmacyAddClinicalEvidence(
      _p: unknown,
      args: { assessmentId: string; kind: string; textValue: string },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.evidence.manage");
      const kind = String(args.kind ?? "").trim() as PharmacyEvidenceKind;
      if (!PHARMACY_EVIDENCE_KINDS.includes(kind)) {
        throw new GraphQLError("kind ไม่ถูกต้อง", { extensions: { code: "BAD_USER_INPUT" } });
      }
      if (kind === "PRESCRIPTION_IMAGE") {
        throw new GraphQLError("รูปใบสั่งยาต้องอัปโหลดผ่าน REST ไม่ใช่ GraphQL", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      const result = await addClinicalEvidence({
        tenantId: getTenantId(ctx),
        assessmentId: args.assessmentId,
        kind,
        textValue: args.textValue,
        actorUserId: ctx?.admin?.id ?? null,
        source: "queue",
      });
      if (result.status === "CASE_NOT_FOUND") {
        throw new GraphQLError("ไม่พบเคสนี้ในร้านนี้", { extensions: { code: "NOT_FOUND" } });
      }
      if (result.status === "INVALID") {
        throw new GraphQLError(result.reason, { extensions: { code: "BAD_USER_INPUT" } });
      }
      // audit เก็บแต่ metadata — เนื้อความเป็นข้อมูลสุขภาพ ไม่ลง audit log
      await audit(ctx, "pharmacy.clinical_evidence.added", result.evidence.id, { kind });
      return result.evidence;
    },
    async bmsPharmacyDeleteClinicalEvidence(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "pharmacy.evidence.manage");
      const ok = await deleteClinicalEvidence(getTenantId(ctx), args.id, ctx?.admin?.id ?? null);
      if (ok) await audit(ctx, "pharmacy.clinical_evidence.deleted", args.id, {});
      return ok;
    },
    async bmsUpsertPharmacyProductPolicy(
      _p: unknown,
      args: { input: UpsertPharmacyProductPolicyInput },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      try {
        const policy = await upsertPharmacyProductPolicyDraft(getTenantId(ctx), args.input);
        await audit(ctx, "pharmacy.product_policy.draft_saved", policy.productSku, {
          productType: policy.productType,
          regulatoryFramework: policy.regulatoryFramework,
          regulatoryClass: policy.regulatoryClass,
          regulatoryEvidenceSource: policy.regulatoryEvidenceSource,
          salePolicy: policy.salePolicy,
        });
        return policy;
      } catch (error: any) {
        throw new GraphQLError(error?.message || "บันทึก Product Policy ไม่สำเร็จ", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
    },
    async bmsSubmitPharmacyProductPolicyForReview(
      _p: unknown,
      args: { productSku: string },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      try {
        const policy = await submitPharmacyProductPolicyForReview(getTenantId(ctx), args.productSku);
        await audit(ctx, "pharmacy.product_policy.submitted", policy.productSku);
        return policy;
      } catch (error: any) {
        throw new GraphQLError(error?.message || "ส่งตรวจ Product Policy ไม่สำเร็จ", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
    },
    async bmsReviewPharmacyProductPolicy(
      _p: unknown,
      args: { productSku: string; decision: string },
      ctx: any
    ) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      const decision = String(args.decision || "").toUpperCase();
      if (decision !== "APPROVE" && decision !== "REJECT") {
        throw new GraphQLError("decision ต้องเป็น APPROVE หรือ REJECT", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      try {
        const policy = await reviewPharmacyProductPolicy(
          getTenantId(ctx),
          args.productSku,
          actorId(ctx),
          decision
        );
        await audit(ctx, "pharmacy.product_policy.reviewed", policy.productSku, { decision });
        return policy;
      } catch (error: any) {
        throw new GraphQLError(error?.message || "ตรวจ Product Policy ไม่สำเร็จ", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
    },
    async bmsSeedPharmacyQueueDemo(
      _p: unknown,
      args: {
        protocolKey?: string | null;
        answers?: Record<string, unknown> | null;
        transcript?: Array<{ role?: unknown; text?: unknown; createdAt?: unknown }> | null;
      },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.read");
      const tenantId = getTenantId(ctx);
      const created = await seedPharmacyQueueDemo(tenantId, args.protocolKey, args.answers, args.transcript, ctx);
      if (created.createdCount === 0) {
        throw new GraphQLError("ไม่พบ protocol ที่เปิดใช้งานสำหรับทดสอบ", { extensions: { code: "BAD_USER_INPUT" } });
      }
      return {
        createdCount: created.createdCount,
        assessmentId: created.assessmentIds[0] ?? null,
        assessmentIds: created.assessmentIds,
      };
    },
    async bmsAssignPharmacist(_p: unknown, args: { assessmentId: string; pharmacistUserId: string }, ctx: any) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.assign");
      const ok = await assignPharmacist(getTenantId(ctx), args.assessmentId, args.pharmacistUserId, ctx);
      if (!ok) throw new GraphQLError("ไม่พบเคสนี้", { extensions: { code: "BAD_USER_INPUT" } });
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsStartPharmacistReview(_p: unknown, args: { assessmentId: string }, ctx: any) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.review");
      const result = await startReview(getTenantId(ctx), args.assessmentId, actorId(ctx), ctx);
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsRequestMoreInformation(
      _p: unknown,
      args: { assessmentId: string; expectedVersion: number; fields: string[]; note?: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.request_more_information");
      const result = await requestMoreInformation(
        getTenantId(ctx),
        args.assessmentId,
        args.expectedVersion,
        args.fields,
        args.note ?? null,
        actorId(ctx),
        ctx
      );
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsApproveAssessment(
      _p: unknown,
      args: { assessmentId: string; expectedVersion: number; pharmacistResponse: string; orderDraft?: unknown },
      ctx: any
    ) {
      requireIntakeEnabled();
      // pharmacy.assessment.approve gates who is OFFERED the button; the
      // unconditional is_licensed_pharmacist check inside approveAssessment()
      // is the actual authorization boundary and is not bypassable by the
      // Administrator super-role.
      await requirePermission(ctx, "pharmacy.assessment.approve");
      const result = await approveAssessment(
        getTenantId(ctx),
        args.assessmentId,
        actorId(ctx),
        args.expectedVersion,
        args.pharmacistResponse,
        args.orderDraft as any,
        ctx
      );
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsRejectAssessment(
      _p: unknown,
      args: { assessmentId: string; expectedVersion: number; reason: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.reject");
      const reason = requireNonEmpty(args.reason, "reason");
      const result = await rejectAssessment(getTenantId(ctx), args.assessmentId, actorId(ctx), args.expectedVersion, reason, ctx);
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsReferAssessmentToDoctor(
      _p: unknown,
      args: { assessmentId: string; expectedVersion: number; reason: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.review");
      const reason = requireNonEmpty(args.reason, "reason");
      const result = await referToDoctor(getTenantId(ctx), args.assessmentId, actorId(ctx), args.expectedVersion, reason, ctx);
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsEscalateAssessmentToEmergency(
      _p: unknown,
      args: { assessmentId: string; reason: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      // A pharmacist choosing to escalate is a "be more conservative" action,
      // not an authorization to dispense — gated by review permission only,
      // no is_licensed_pharmacist check (unlike approve/reject/refer).
      await requirePermission(ctx, "pharmacy.assessment.review");
      const reason = requireNonEmpty(args.reason, "reason");
      const ok = await escalateToEmergency(getTenantId(ctx), args.assessmentId, reason, ctx);
      if (!ok) throw new GraphQLError("ไม่พบเคสนี้ หรือสถานะปัจจุบันส่งต่อฉุกเฉินไม่ได้", { extensions: { code: "BAD_USER_INPUT" } });
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsEditAssessmentSummary(
      _p: unknown,
      args: { assessmentId: string; summaryText: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.review");
      const summaryText = requireNonEmpty(args.summaryText, "summaryText");
      const result = await editAssessmentSummary(getTenantId(ctx), args.assessmentId, summaryText, actorId(ctx), ctx);
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsEditPharmacistDecisionNotes(
      _p: unknown,
      args: { assessmentId: string; expectedVersion: number; decisionNotes: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.review");
      const decisionNotes = requireNonEmpty(args.decisionNotes, "decisionNotes");
      if (decisionNotes.length > 10_000) {
        throw new GraphQLError("decisionNotes ยาวเกิน 10,000 ตัวอักษร", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      const result = await editPharmacistDecisionNotes(
        getTenantId(ctx),
        args.assessmentId,
        args.expectedVersion,
        decisionNotes,
        actorId(ctx),
        ctx
      );
      if (result.status !== "OK") decisionResultToGraphQLError(result);
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsGenerateMedicationSuggestions(_p: unknown, args: { assessmentId: string }, ctx: any) {
      requireIntakeEnabled();
      // Staff-initiated only (explicit button click) — never called from the
      // customer pipeline. Gated the same as edit-summary/escalate: viewing
      // a suggestion doesn't itself dispense anything, the unconditional
      // is_licensed_pharmacist check inside approveAssessment() is still the
      // real authorization boundary for the case's final decision.
      await requirePermission(ctx, "pharmacy.assessment.review");
      if (!isPharmacyAiEnabled()) {
        throw new GraphQLError("AI ปิดอยู่ (PHARMACY_AI_ENABLED=false) — ไม่สามารถขอคำแนะนำยาได้", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      const tenantId = getTenantId(ctx);
      const assessment = await getAssessment(tenantId, args.assessmentId);
      if (!assessment) throw new GraphQLError("ไม่พบเคสนี้", { extensions: { code: "BAD_USER_INPUT" } });
      if (assessment.status !== "PHARMACIST_REVIEWING") {
        throw new GraphQLError("ขอคำแนะนำยาได้เฉพาะตอนเภสัชกรกำลังตรวจสอบเคสอยู่ (PHARMACIST_REVIEWING)", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      if (!assessment.protocolId) throw new GraphQLError("เคสนี้ยังไม่มี protocol ผูกอยู่", { extensions: { code: "BAD_USER_INPUT" } });
      const medicationSafetyMissing: string[] = [];
      if (assessment.patientAgeYears == null) medicationSafetyMissing.push("อายุ");
      if (assessment.biologicalSex === "UNKNOWN") medicationSafetyMissing.push("เพศกำเนิด");
      if (assessment.biologicalSex === "FEMALE" && assessment.pregnancyStatus === "UNKNOWN") {
        medicationSafetyMissing.push("สถานะตั้งครรภ์");
      }
      if (assessment.biologicalSex === "FEMALE" && assessment.breastfeedingStatus === "UNKNOWN") {
        medicationSafetyMissing.push("สถานะให้นมบุตร");
      }
      const structuredAnswers = assessment.structuredAnswers as Record<string, unknown>;
      if (!("allergies" in structuredAnswers)) medicationSafetyMissing.push("ประวัติแพ้ยา");
      if (!("current_medications" in structuredAnswers)) medicationSafetyMissing.push("ยาที่ใช้อยู่");
      if (medicationSafetyMissing.length > 0) {
        throw new GraphQLError(
          `ข้อมูลความปลอดภัยยังไม่ครบ: ${medicationSafetyMissing.join(", ")} — กรุณาเก็บข้อมูลก่อนขอข้อเสนอจาก AI`,
          { extensions: { code: "BAD_USER_INPUT" } }
        );
      }
      const protocol = await getPharmacyProtocol(tenantId, assessment.protocolId);
      if (!protocol) throw new GraphQLError("ไม่พบ protocol ของเคสนี้", { extensions: { code: "BAD_USER_INPUT" } });
      const allergiesText = String(structuredAnswers.allergies ?? "");
      const currentMedicationsText = String(structuredAnswers.current_medications ?? "");
      const ai = new AnthropicCompatiblePharmacyIntakeAI();
      const result = await ai.suggestMedications({
        tenantId,
        caseId: args.assessmentId,
        symptomGroup: protocol.supportedSymptomGroup,
        allAnswers: assessment.structuredAnswers,
        allergiesText,
        currentMedicationsText,
        pregnancyStatus: assessment.pregnancyStatus,
        breastfeedingStatus: assessment.breastfeedingStatus,
        patientAgeYears: assessment.patientAgeYears,
        locale: "th",
      });
      if (!result) {
        throw new GraphQLError("AI ไม่พร้อมใช้งานตอนนี้ ลองใหม่อีกครั้ง หรือกรอกคำแนะนำเองได้", {
          extensions: { code: "BAD_USER_INPUT" },
        });
      }
      const { kept, excluded } = filterMedicationSuggestionsAgainstAllergies(result, allergiesText);
      const productPolicies = await listPharmacyProductPolicies(tenantId);
      const productPolicyBySku = new Map(productPolicies.map((policy) => [policy.productSku, policy]));
      const suggestionSurface = catalogSurfaceForChannel(assessment.channelId);
      const withCatalogMatches = async <T extends { drugName: string; strength?: string; dosageInstruction?: string }>(suggestion: T) => {
        const bySku = new Map<
          string,
          {
            sku: string;
            name: string;
            price: number;
            availableTotal: number;
            availableSizes: Array<{ size: string; available: number }>;
            productType: string;
            salePolicy: string;
            policyStatus: string;
          }
        >();
        for (const term of buildPharmacySearchTerms(suggestion)) {
          const { items } = await listSellableProducts(tenantId, {
            search: term,
            inStockOnly: true,
            sort: "relevance",
            limit: 3,
            salesSurface: suggestionSurface,
          });
          for (const item of items) {
            if (!bySku.has(item.sku)) {
              bySku.set(item.sku, {
                sku: item.sku,
                name: item.name,
                price: item.price,
                availableTotal: item.availableTotal,
                availableSizes: Array.isArray(item.availableSizes)
                  ? item.availableSizes.filter((variant) => Number(variant.available) > 0)
                  : [],
                productType: productPolicyBySku.get(item.sku)?.productType ?? "UNKNOWN",
                salePolicy: productPolicyBySku.get(item.sku)?.salePolicy ?? "UNKNOWN",
                policyStatus: productPolicyBySku.get(item.sku)?.status ?? "MISSING",
              });
            }
            if (bySku.size >= 5) break;
          }
          if (bySku.size >= 5) break;
        }
        return {
          ...suggestion,
          catalogMatches: Array.from(bySku.values()),
        };
      };
      const stored = [
        ...(await Promise.all(kept.map(async (s) => ({ ...(await withCatalogMatches(s)), excluded: false })))),
        ...(await Promise.all(
          excluded.map(async (e) => ({
            ...(await withCatalogMatches(e.suggestion)),
            excluded: true,
            exclusionReason: e.reason,
          }))
        )),
      ];
      await recordMedicationSuggestions(tenantId, args.assessmentId, stored, actorId(ctx), ctx);
      return getAssessment(tenantId, args.assessmentId);
    },
    async bmsManualFillAssessmentFields(
      _p: unknown,
      args: { assessmentId: string; fields: Record<string, string | number> },
      ctx: any
    ) {
      requireIntakeEnabled();
      // Closes the "AI degraded mid-conversation" dead end — a pharmacist
      // supplying the missing structured data by hand, re-run through the
      // SAME deterministic rule engine the AI-driven path uses.
      await requirePermission(ctx, "pharmacy.assessment.review");
      if (!args.fields || typeof args.fields !== "object" || Object.keys(args.fields).length === 0) {
        throw new GraphQLError("ต้องระบุ fields อย่างน้อย 1 รายการ", { extensions: { code: "BAD_USER_INPUT" } });
      }
      try {
        await applyManualAnswers(getTenantId(ctx), args.assessmentId, args.fields, actorId(ctx), ctx);
      } catch (err: any) {
        throw new GraphQLError(err?.message || "บันทึกข้อมูลไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsSetPharmacistLicense(
      _p: unknown,
      args: { userId: string; isLicensedPharmacist: boolean; licenseNo?: string },
      ctx: any
    ) {
      requireAdministrator(ctx);
      const tenantId = getTenantId(ctx);
      const res = await query(
        `UPDATE users SET is_licensed_pharmacist = $3, pharmacist_license_no = $4
          WHERE id = $1 AND tenant_id = $2`,
        [args.userId, tenantId, args.isLicensedPharmacist, args.licenseNo ?? null]
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new GraphQLError("ไม่พบผู้ใช้นี้ในร้านนี้", { extensions: { code: "BAD_USER_INPUT" } });
      }
      await audit(ctx, "pharmacy.pharmacist_license_set", args.userId, { isLicensedPharmacist: args.isLicensedPharmacist });
      return true;
    },
    async bmsSoftDeleteAssessment(_p: unknown, args: { assessmentId: string }, ctx: any) {
      // Data-governance action, not a clinical one — Administrator only,
      // same standalone check as license granting. Only terminal (already
      // decided/closed) cases are eligible; see softDeleteAssessment().
      requireAdministrator(ctx);
      const ok = await softDeleteAssessment(getTenantId(ctx), args.assessmentId, actorId(ctx), ctx);
      if (!ok) {
        throw new GraphQLError("ไม่พบเคสนี้ หรือเคสยังไม่ปิด (ลบได้เฉพาะเคสที่จบแล้ว)", { extensions: { code: "BAD_USER_INPUT" } });
      }
      return true;
    },
    async bmsRecordPharmacyConsent(
      _p: unknown,
      args: { assessmentId: string; status: "GRANTED" | "REVOKED"; consentVersion: string },
      ctx: any
    ) {
      requireIntakeEnabled();
      await requirePermission(ctx, "pharmacy.assessment.read");
      if (args.status !== "GRANTED" && args.status !== "REVOKED") {
        throw new GraphQLError('status ต้องเป็น "GRANTED" หรือ "REVOKED"', { extensions: { code: "BAD_USER_INPUT" } });
      }
      const ok = await recordConsent(getTenantId(ctx), args.assessmentId, args.status, requireNonEmpty(args.consentVersion, "consentVersion"));
      if (!ok) throw new GraphQLError("ไม่พบเคสนี้", { extensions: { code: "BAD_USER_INPUT" } });
      return getAssessment(getTenantId(ctx), args.assessmentId);
    },
    async bmsUpsertPharmacyProtocol(_p: unknown, args: { input: UpsertPharmacyProtocolInput }, ctx: any) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      try {
        const protocol = await upsertPharmacyProtocol(getTenantId(ctx), args.input);
        return protocol;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "บันทึกไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsSetPharmacyProtocolEnabled(_p: unknown, args: { id: string; enabled: boolean }, ctx: any) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      try {
        return await setPharmacyProtocolEnabled(getTenantId(ctx), args.id, args.enabled);
      } catch (err: any) {
        throw new GraphQLError(err?.message || "ดำเนินการไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsSubmitPharmacyProtocolForReview(_p: unknown, args: { id: string }, ctx: any) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      try {
        const protocol = await submitPharmacyProtocolForReview(getTenantId(ctx), args.id);
        await audit(ctx, "pharmacy.protocol.review_requested", `pharmacy_protocol:${args.id}`, {});
        return protocol;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "ส่งตรวจไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
    async bmsReviewPharmacyProtocol(_p: unknown, args: { id: string; decision: string }, ctx: any) {
      await requirePermission(ctx, "pharmacy.protocol.manage");
      const decision = String(args.decision || "").toUpperCase();
      if (decision !== "APPROVE" && decision !== "REJECT") {
        throw new GraphQLError("decision ต้องเป็น APPROVE หรือ REJECT", { extensions: { code: "BAD_USER_INPUT" } });
      }
      try {
        const protocol = await reviewPharmacyProtocol(getTenantId(ctx), args.id, actorId(ctx), decision);
        await audit(ctx, `pharmacy.protocol.${decision.toLowerCase()}`, `pharmacy_protocol:${args.id}`, {});
        return protocol;
      } catch (err: any) {
        throw new GraphQLError(err?.message || "ตรวจ protocol ไม่สำเร็จ", { extensions: { code: "BAD_USER_INPUT" } });
      }
    },
  },
};
