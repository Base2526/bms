import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { listCustomers } from "@/lib/bms/customers";
import {
  activateSalonPackageFromSale, createSalonAppointment, getSalonBoard, listSalonClientCare,
  redeemSalonPackageUse, saveSalonPackagePlan, transitionSalonAppointment,
  upsertSalonClientProfile, upsertSalonResource, upsertSalonServiceSetting,
  type SalonAppointmentStatus,
} from "@/lib/bms/salon";
import { withRouteErrorLog } from "@/lib/log/routeError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const optionalText = (v: unknown) => text(v) || null;
const fail = (error: unknown, status = 400) => NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });

async function handleGET(req: NextRequest) {
  const wantsCare = req.nextUrl.searchParams.has("customerId");
  const auth = await authorizeAdminRoute(wantsCare ? "salon.client_notes.manage" : "salon.view");
  if (!auth.ok) return fail(auth.status === 401 ? "unauthorized" : "forbidden", auth.status);
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (customerId) return NextResponse.json(await listSalonClientCare(auth.tenantId, customerId));
  const customerSearch = req.nextUrl.searchParams.get("customerSearch");
  if (customerSearch != null) return NextResponse.json({ customers: await listCustomers(auth.tenantId, customerSearch, 30) });
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!from || !to) return fail("ต้องระบุช่วงเวลา from/to");
  return NextResponse.json(await getSalonBoard({ tenantId: auth.tenantId, from, to, locationId: req.nextUrl.searchParams.get("locationId") }));
}

async function handlePOST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const action = text(body.action);
  const permission = action === "client_profile" ? "salon.client_notes.manage"
    : ["package_plan", "package_activate", "package_redeem"].includes(action) ? "salon.package.manage"
    : "salon.manage";
  const auth = await authorizeAdminRoute(permission);
  if (!auth.ok) return fail(auth.status === 401 ? "unauthorized" : "forbidden", auth.status);
  const common = { tenantId: auth.tenantId, actorUserId: String(auth.adminId) };
  try {
    if (action === "appointment_create") return NextResponse.json(await createSalonAppointment({
      ...common, locationId: text(body.locationId), customerId: text(body.customerId),
      source: ["STAFF","ONLINE","CUSTOMER_AI","WALK_IN"].includes(body.source) ? body.source : "STAFF",
      note: optionalText(body.note), services: Array.isArray(body.services) ? body.services.map((s: any) => ({
        productSku: text(s.productSku), staffUserId: text(s.staffUserId), resourceId: optionalText(s.resourceId),
        startsAt: text(s.startsAt), endsAt: text(s.endsAt), note: optionalText(s.note),
      })) : [],
    }));
    if (action === "appointment_status") return NextResponse.json(await transitionSalonAppointment({
      ...common, appointmentId: text(body.appointmentId), status: text(body.status) as SalonAppointmentStatus, orderId: optionalText(body.orderId),
    }));
    if (action === "service_setting") return NextResponse.json(await upsertSalonServiceSetting({
      ...common, productSku: text(body.productSku), durationMinutes: Number(body.durationMinutes), bufferMinutes: Number(body.bufferMinutes ?? 0), onlineBookable: Boolean(body.onlineBookable), active: body.active !== false,
    }));
    if (action === "resource") return NextResponse.json(await upsertSalonResource({
      ...common, id: optionalText(body.id), locationId: text(body.locationId), name: text(body.name), resourceType: body.resourceType, active: body.active !== false,
    }));
    if (action === "client_profile") return NextResponse.json(await upsertSalonClientProfile({
      ...common, customerId: text(body.customerId), allergyNotes: optionalText(body.allergyNotes), formulaNotes: optionalText(body.formulaNotes), preferenceNotes: optionalText(body.preferenceNotes), photoConsent: Boolean(body.photoConsent), marketingConsent: Boolean(body.marketingConsent),
    }));
    if (action === "package_plan") return NextResponse.json(await saveSalonPackagePlan({
      ...common, id: optionalText(body.id), name: text(body.name), saleProductSku: text(body.saleProductSku), serviceProductSku: text(body.serviceProductSku), totalUses: Number(body.totalUses), validityDays: Number(body.validityDays), active: body.active !== false,
    }));
    if (action === "package_activate") return NextResponse.json(await activateSalonPackageFromSale({
      ...common, planId: text(body.planId), customerId: text(body.customerId), orderItemId: Number(body.orderItemId),
    }));
    if (action === "package_redeem") return NextResponse.json(await redeemSalonPackageUse({
      ...common, customerPackageId: text(body.customerPackageId), appointmentServiceId: text(body.appointmentServiceId),
    }));
    return fail("action ไม่ถูกต้อง");
  } catch (error) { return fail(error); }
}

export const GET = withRouteErrorLog("GET /api/bms/salon", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/salon", handlePOST);
