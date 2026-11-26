import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminRoute } from "@/lib/bms/adminRouteAuth";
import { myPermissions, type BmsPermission } from "@/lib/bms/permissions";
import { withRouteErrorLog } from "@/lib/log/routeError";
import {
  ClinicError, clinicBootstrap, grantClinicStaff, listClinicAccessEvents, type ClinicRole,
} from "@/lib/bms/clinic/access";
import {
  addVerifiedClinicContact, listClinicContacts, readClinicPatient, registerClinicPatient, searchClinicPatients,
} from "@/lib/bms/clinic/patients";
import {
  createClinicAppointment, listClinicAppointments, rescheduleClinicAppointment, transitionClinicAppointment,
} from "@/lib/bms/clinic/appointments";
import {
  addClinicAddendum, assignClinicNurse, listClinicPatientEncounters,
  openClinicEncounter, readClinicEmergencyAccess, readClinicEncounter, requestClinicEmergencyAccess,
  revokeClinicEmergencyAccess, saveClinicDraft, signClinicEncounter,
} from "@/lib/bms/clinic/encounters";
import {
  createClinicChargeOrder, listBillableClinicEncounters, readClinicChargeSheet,
  reviewClinicChargeSheet, saveClinicChargeSheet,
} from "@/lib/bms/clinic/billing";
import { listClinicAttachments } from "@/lib/bms/clinic/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GET_PERMISSIONS: Record<string, BmsPermission | null> = {
  bootstrap: null, searchPatients: "clinic.patient.read",
  patient: "clinic.patient.read", appointments: "clinic.appointment.manage",
  encounter: "clinic.record.read", history: "clinic.record.read",
  chargeSheet: "clinic.billing.manage",
  billableEncounters: "clinic.billing.manage",
  accessEvents: "clinic.audit.read",
  attachments: "clinic.record.read",
  contacts: "clinic.patient.read",
  emergencyAccess: "clinic.record.read",
};
const POST_PERMISSIONS: Record<string, BmsPermission> = {
  grantStaff: "clinic.staff.manage", registerPatient: "clinic.patient.register",
  addContact: "clinic.patient.register", createAppointment: "clinic.appointment.manage",
  appointmentTransition: "clinic.appointment.manage", openEncounter: "clinic.record.write",
  rescheduleAppointment: "clinic.appointment.manage",
  saveDraft: "clinic.record.write", signEncounter: "clinic.record.sign",
  addendum: "clinic.record.sign", assignNurse: "clinic.record.sign",
  saveChargeSheet: "clinic.billing.manage", reviewChargeSheet: "clinic.billing.manage",
  createChargeOrder: "clinic.billing.manage",
  emergencyAccess: "clinic.record.read",
  revokeEmergencyAccess: "clinic.record.read",
};

function errorResponse(error: unknown) {
  const status = error instanceof ClinicError ? error.status : 500;
  const code = error instanceof ClinicError ? error.code : "CLINIC_UNAVAILABLE";
  return NextResponse.json({ status: code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function handleGET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") ?? "";
  const permission = GET_PERMISSIONS[action];
  if (permission === undefined) return NextResponse.json({ status: "INVALID_ACTION" }, { status: 400 });
  const auth = await authorizeAdminRoute(permission);
  if (!auth.ok) return NextResponse.json({ status: auth.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
    { status: auth.status });
  const actorId = String(auth.adminId);
  const tenantId = auth.tenantId;
  const p = req.nextUrl.searchParams;
  try {
    if (action === "bootstrap" && !(await myPermissions(auth.ctx)).some((item) => item.startsWith("clinic.")))
      return NextResponse.json({ status: "FORBIDDEN" }, { status: 403 });
    let result: unknown;
    switch (action) {
      case "bootstrap":
        result = await clinicBootstrap(tenantId, actorId, auth.admin.role === "Administrator"); break;
      case "searchPatients":
        result = await searchClinicPatients({ tenantId, actorId, search: p.get("search") }); break;
      case "patient":
        result = await readClinicPatient({ tenantId, actorId, patientId: p.get("patientId") }); break;
      case "appointments":
        result = await listClinicAppointments({ tenantId, actorId, locationId: p.get("locationId"),
          from: p.get("from"), to: p.get("to") }); break;
      case "encounter":
        result = await readClinicEncounter({ tenantId, actorId, encounterId: p.get("encounterId") }); break;
      case "history":
        result = await listClinicPatientEncounters({ tenantId, actorId, patientId: p.get("patientId") }); break;
      case "chargeSheet":
        result = await readClinicChargeSheet({ tenantId, actorId, encounterId: p.get("encounterId") }); break;
      case "billableEncounters":
        result = await listBillableClinicEncounters({ tenantId, actorId, search: p.get("search") }); break;
      case "accessEvents":
        result = await listClinicAccessEvents({ tenantId, actorId, patientId: p.get("patientId") }); break;
      case "attachments":
        result = await listClinicAttachments({ tenantId, actorId, encounterId: p.get("encounterId") }); break;
      case "contacts":
        result = await listClinicContacts({ tenantId, actorId, patientId: p.get("patientId") }); break;
      case "emergencyAccess":
        result = await readClinicEmergencyAccess({ tenantId, actorId, patientId: p.get("patientId") }); break;
    }
    return NextResponse.json({ status: "OK", result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

async function handlePOST(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ status: "INVALID_BODY" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 32_768) {
      await reader.cancel();
      return NextResponse.json({ status: "BODY_TOO_LARGE" }, { status: 413 });
    }
    chunks.push(part.value);
  }
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { return NextResponse.json({ status: "INVALID_JSON" }, { status: 400 }); }
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ status: "INVALID_JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ status: "INVALID_BODY" }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "";
  const permission = POST_PERMISSIONS[action];
  if (!permission) return NextResponse.json({ status: "INVALID_ACTION" }, { status: 400 });
  const auth = await authorizeAdminRoute(permission);
  if (!auth.ok) return NextResponse.json({ status: auth.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" },
    { status: auth.status });
  const actorId = String(auth.adminId);
  const tenantId = auth.tenantId;
  try {
    let result: unknown = null;
    switch (action) {
      case "grantStaff":
        if (auth.admin.role !== "Administrator") return NextResponse.json({ status: "FORBIDDEN" }, { status: 403 });
        await grantClinicStaff({ tenantId, actorId, userId: body.userId as string, role: body.role as ClinicRole,
          active: body.active as boolean, licenceNo: body.licenceNo as string | null,
          confirmation: body.confirmation as string });
        break;
      case "registerPatient":
        result = await registerClinicPatient({ tenantId, actorId, fullName: body.fullName,
          dob: body.dob, sex: body.sex, phone: body.phone }); break;
      case "addContact":
        result = await addVerifiedClinicContact({ tenantId, actorId, patientId: body.patientId,
          fullName: body.fullName, relationship: body.relationship,
          phone: body.phone, confirmation: body.confirmation }); break;
      case "createAppointment":
        result = await createClinicAppointment({ tenantId, actorId, patientId: body.patientId,
          locationId: body.locationId, practitionerId: body.practitionerId,
          roomCode: body.roomCode, startsAt: body.startsAt, endsAt: body.endsAt,
          requestKey: body.requestKey }); break;
      case "appointmentTransition":
        await transitionClinicAppointment({ tenantId, actorId, appointmentId: body.appointmentId,
          action: body.transition as "CHECK_IN" | "CANCEL" | "NO_SHOW" }); break;
      case "rescheduleAppointment":
        result = await rescheduleClinicAppointment({ tenantId, actorId, appointmentId: body.appointmentId,
          practitionerId: body.practitionerId, roomCode: body.roomCode,
          startsAt: body.startsAt, endsAt: body.endsAt, requestKey: body.requestKey }); break;
      case "openEncounter":
        result = await openClinicEncounter({ tenantId, actorId, appointmentId: body.appointmentId }); break;
      case "saveDraft":
        result = await saveClinicDraft({ tenantId, actorId, encounterId: body.encounterId,
          expectedVersion: body.expectedVersion, record: body.record }); break;
      case "signEncounter":
        result = await signClinicEncounter({ tenantId, actorId, encounterId: body.encounterId,
          expectedVersion: body.expectedVersion, confirmation: body.confirmation }); break;
      case "addendum":
        result = await addClinicAddendum({ tenantId, actorId, encounterId: body.encounterId,
          parentNoteId: body.parentNoteId, reason: body.reason, record: body.record,
          confirmation: body.confirmation }); break;
      case "assignNurse":
        await assignClinicNurse({ tenantId, actorId, encounterId: body.encounterId,
          nurseUserId: body.nurseUserId, active: body.active,
          confirmation: body.confirmation }); break;
      case "saveChargeSheet":
        result = await saveClinicChargeSheet({ tenantId, actorId, encounterId: body.encounterId,
          lines: body.lines }); break;
      case "reviewChargeSheet":
        await reviewClinicChargeSheet({ tenantId, actorId, sheetId: body.sheetId,
          confirmation: body.confirmation }); break;
      case "createChargeOrder":
        result = await createClinicChargeOrder({ tenantId, actorId, sheetId: body.sheetId,
          confirmation: body.confirmation }); break;
      case "emergencyAccess":
        result = await requestClinicEmergencyAccess({ tenantId, actorId, patientId: body.patientId,
          reason: body.reason, confirmation: body.confirmation }); break;
      case "revokeEmergencyAccess":
        result = await revokeClinicEmergencyAccess({ tenantId, actorId, patientId: body.patientId,
          confirmation: body.confirmation }); break;
    }
    return NextResponse.json({ status: "OK", result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

export const GET = withRouteErrorLog("GET /api/bms/clinic", handleGET);
export const POST = withRouteErrorLog("POST /api/bms/clinic", handlePOST);
