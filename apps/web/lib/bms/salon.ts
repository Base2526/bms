import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";
import { beginTenantTx } from "./tenant";

export const SALON_ACTIVE_STATUSES = ["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_SERVICE"] as const;
export type SalonAppointmentStatus = typeof SALON_ACTIVE_STATUSES[number] | "COMPLETED" | "CANCELLED" | "NO_SHOW";

const STATUS_TRANSITIONS: Record<SalonAppointmentStatus, readonly SalonAppointmentStatus[]> = {
  BOOKED: ["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["IN_SERVICE", "CANCELLED"],
  IN_SERVICE: ["COMPLETED"],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};

export function salonStatusTransitionAllowed(from: SalonAppointmentStatus, to: SalonAppointmentStatus) {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateSalonInterval(startsAt: string, endsAt: string): string | null {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "วันเวลานัดไม่ถูกต้อง";
  if (end <= start) return "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม";
  if (end - start > 12 * 60 * 60_000) return "นัดหมายหนึ่งรายการยาวเกิน 12 ชั่วโมง";
  return null;
}

export function validateSalonBoardRange(from: string, to: string): string | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "ช่วงวันที่ไม่ถูกต้อง";
  if (end - start > 62 * 24 * 60 * 60_000) return "ช่วงวันที่ต้องไม่เกิน 62 วัน";
  return null;
}

async function auditInTx(client: PoolClient, input: {
  tenantId: string; actorUserId: string; action: string; target?: string | null; meta?: Record<string, unknown>;
}) {
  await client.query(
    `INSERT INTO bms_audit_log (tenant_id, actor, action, target, meta) VALUES ($1,$2,$3,$4,$5)`,
    [input.tenantId, input.actorUserId, input.action, input.target ?? null, JSON.stringify(input.meta ?? {})],
  );
}

export async function getSalonBoard(input: {
  tenantId: string; from: string; to: string; locationId?: string | null;
}) {
  const rangeProblem = validateSalonBoardRange(input.from, input.to);
  if (rangeProblem) throw new Error(rangeProblem);
  const appointments = await query<any>(
    `SELECT a.id,a.location_id,a.customer_id,a.status,a.source,a.starts_at,a.ends_at,a.note,a.order_id,
            c.name AS customer_name,c.phone AS customer_phone,l.name AS location_name,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id',s.id,'sku',s.product_sku,'productName',p.name,'staffUserId',s.staff_user_id,
              'staffName',COALESCE(u.name,u.email),'resourceId',s.resource_id,'resourceName',r.name,
              'startsAt',s.starts_at,'endsAt',s.ends_at,'note',s.note
            ) ORDER BY s.starts_at) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS services
       FROM bms_salon_appointments a
       JOIN bms_customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
       JOIN bms_locations l ON l.id=a.location_id AND l.tenant_id=a.tenant_id
       LEFT JOIN bms_salon_appointment_services s ON s.tenant_id=a.tenant_id AND s.appointment_id=a.id
       LEFT JOIN bms_products p ON p.tenant_id=s.tenant_id AND p.sku=s.product_sku
       LEFT JOIN users u ON u.id=s.staff_user_id AND u.tenant_id=s.tenant_id
       LEFT JOIN bms_salon_resources r ON r.tenant_id=s.tenant_id AND r.id=s.resource_id
      WHERE a.tenant_id=$1 AND a.starts_at < $3::timestamptz AND a.ends_at > $2::timestamptz
        AND ($4::uuid IS NULL OR a.location_id=$4)
      GROUP BY a.id,c.name,c.phone,l.name
      ORDER BY a.starts_at,a.created_at`,
    [input.tenantId, input.from, input.to, input.locationId || null],
  );
  const [resources, settings, staff, packagePlans, locations] = await Promise.all([
    query<any>(`SELECT id,location_id,name,resource_type,active FROM bms_salon_resources WHERE tenant_id=$1 ORDER BY active DESC,name`, [input.tenantId]),
    query<any>(`SELECT s.product_sku,p.name,s.duration_minutes,s.buffer_minutes,s.online_bookable,s.active
                  FROM bms_salon_service_settings s JOIN bms_products p ON p.tenant_id=s.tenant_id AND p.sku=s.product_sku
                 WHERE s.tenant_id=$1 ORDER BY s.active DESC,p.name`, [input.tenantId]),
    query<any>(`SELECT id,COALESCE(name,email) AS name,email FROM users WHERE tenant_id=$1 ORDER BY COALESCE(name,email)`, [input.tenantId]),
    query<any>(`SELECT id,name,sale_product_sku,service_product_sku,total_uses,validity_days,active FROM bms_salon_package_plans WHERE tenant_id=$1 ORDER BY active DESC,name`,[input.tenantId]),
    query<any>(`SELECT id,code,name,active FROM bms_locations WHERE tenant_id=$1 ORDER BY active DESC,is_head_office DESC,code`,[input.tenantId]),
  ]);
  return { appointments: appointments.rows, resources: resources.rows, serviceSettings: settings.rows, staff: staff.rows, packagePlans: packagePlans.rows, locations: locations.rows };
}

export type SalonAppointmentServiceInput = {
  productSku: string; staffUserId: string; resourceId?: string | null; startsAt: string; endsAt: string; note?: string | null;
};

async function assertAppointmentScope(client: PoolClient, tenantId: string, locationId: string, customerId: string) {
  const scope = await client.query<{ location: boolean; customer: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$2 AND active) AS location,
            EXISTS(SELECT 1 FROM bms_customers WHERE tenant_id=$1 AND id=$3 AND deleted_at IS NULL) AS customer`,
    [tenantId, locationId, customerId],
  );
  if (!scope.rows[0]?.location) throw new Error("ไม่พบสาขานี้ในร้าน");
  if (!scope.rows[0]?.customer) throw new Error("ไม่พบลูกค้านี้ในร้าน");
}

async function assertSalonServiceLines(client: PoolClient, input: {
  tenantId: string; locationId: string; services: SalonAppointmentServiceInput[]; excludeAppointmentId?: string;
}) {
  if (!input.services.length || input.services.length > 20) throw new Error("นัดหมายต้องมีบริการ 1–20 รายการ");
  for (const service of input.services) {
    const problem = validateSalonInterval(service.startsAt, service.endsAt);
    if (problem) throw new Error(problem);
    // Transaction advisory locks serialize bookings for the same staff/resource across instances.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`salon:staff:${input.tenantId}:${service.staffUserId}`]);
    if (service.resourceId) await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`salon:resource:${input.tenantId}:${service.resourceId}`]);
    const valid = await client.query<{ product: boolean; staff: boolean; resource: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM bms_salon_service_settings x JOIN bms_product_stock_policies sp
               ON sp.tenant_id=x.tenant_id AND sp.product_sku=x.product_sku
             WHERE x.tenant_id=$1 AND x.product_sku=$2 AND x.active AND sp.stock_policy='NON_STOCK') AS product,
              EXISTS(SELECT 1 FROM users WHERE tenant_id=$1 AND id=$3) AS staff,
              ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM bms_salon_resources WHERE tenant_id=$1 AND location_id=$5 AND id=$4 AND active)) AS resource`,
      [input.tenantId, service.productSku.trim(), service.staffUserId, service.resourceId || null, input.locationId],
    );
    if (!valid.rows[0]?.product) throw new Error(`บริการ ${service.productSku} ต้องเป็น NON_STOCK และเปิดใช้ในตั้งค่าร้านเสริมสวย`);
    if (!valid.rows[0]?.staff) throw new Error("ไม่พบช่างที่เลือกในร้าน");
    if (!valid.rows[0]?.resource) throw new Error("ทรัพยากรไม่อยู่ในสาขาที่เลือก");
    const conflict = await client.query<{ staff_conflict: boolean; resource_conflict: boolean }>(
      `SELECT EXISTS(
          SELECT 1 FROM bms_salon_appointment_services s JOIN bms_salon_appointments a ON a.tenant_id=s.tenant_id AND a.id=s.appointment_id
           WHERE s.tenant_id=$1 AND s.staff_user_id=$2 AND s.starts_at < $4::timestamptz AND s.ends_at > $3::timestamptz
             AND a.status=ANY($5::text[]) AND ($6::uuid IS NULL OR a.id<>$6)
        ) AS staff_conflict,
        ($7::uuid IS NOT NULL AND EXISTS(
          SELECT 1 FROM bms_salon_appointment_services s JOIN bms_salon_appointments a ON a.tenant_id=s.tenant_id AND a.id=s.appointment_id
           WHERE s.tenant_id=$1 AND s.resource_id=$7 AND s.starts_at < $4::timestamptz AND s.ends_at > $3::timestamptz
             AND a.status=ANY($5::text[]) AND ($6::uuid IS NULL OR a.id<>$6)
        )) AS resource_conflict`,
      [input.tenantId, service.staffUserId, service.startsAt, service.endsAt, [...SALON_ACTIVE_STATUSES], input.excludeAppointmentId ?? null, service.resourceId || null],
    );
    if (conflict.rows[0]?.staff_conflict) throw new Error("ช่างมีนัดอื่นในช่วงเวลานี้");
    if (conflict.rows[0]?.resource_conflict) throw new Error("เก้าอี้/ห้อง/อุปกรณ์ถูกจองในช่วงเวลานี้");
  }
}

export async function createSalonAppointment(input: {
  tenantId: string; actorUserId: string; locationId: string; customerId: string;
  source?: "STAFF" | "ONLINE" | "CUSTOMER_AI" | "WALK_IN"; note?: string | null;
  services: SalonAppointmentServiceInput[];
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client, input.tenantId, { editorId: input.actorUserId });
    await assertAppointmentScope(client, input.tenantId, input.locationId, input.customerId);
    await assertSalonServiceLines(client, { tenantId: input.tenantId, locationId: input.locationId, services: input.services });
    const startsAt = input.services.reduce((v, s) => v < s.startsAt ? v : s.startsAt, input.services[0].startsAt);
    const endsAt = input.services.reduce((v, s) => v > s.endsAt ? v : s.endsAt, input.services[0].endsAt);
    const appointment = await client.query<{ id: string }>(
      `INSERT INTO bms_salon_appointments (tenant_id,location_id,customer_id,source,starts_at,ends_at,note,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [input.tenantId,input.locationId,input.customerId,input.source ?? "STAFF",startsAt,endsAt,input.note?.trim() || null,input.actorUserId],
    );
    for (const service of input.services) await client.query(
      `INSERT INTO bms_salon_appointment_services
       (tenant_id,appointment_id,product_sku,staff_user_id,resource_id,starts_at,ends_at,note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [input.tenantId,appointment.rows[0].id,service.productSku.trim(),service.staffUserId,service.resourceId || null,service.startsAt,service.endsAt,service.note?.trim() || null],
    );
    await auditInTx(client,{ tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.appointment.create",target:appointment.rows[0].id,meta:{ source:input.source ?? "STAFF",serviceCount:input.services.length } });
    await client.query("COMMIT");
    return { status: "CREATED" as const, id: appointment.rows[0].id };
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}

export async function transitionSalonAppointment(input: {
  tenantId: string; actorUserId: string; appointmentId: string; status: SalonAppointmentStatus; orderId?: string | null;
}) {
  const client = await getClient();
  try {
    await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const current = await client.query<{ status: SalonAppointmentStatus; customer_id: string }>(
      `SELECT status,customer_id FROM bms_salon_appointments WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[input.tenantId,input.appointmentId]);
    if (!current.rowCount) throw new Error("ไม่พบนัดหมาย");
    if (!salonStatusTransitionAllowed(current.rows[0].status,input.status)) throw new Error(`เปลี่ยนสถานะ ${current.rows[0].status} → ${input.status} ไม่ได้`);
    let orderId: string | null = null;
    if (input.status === "COMPLETED") {
      if (!input.orderId) throw new Error("ปิดงานต้องผูกบิล POS ที่ชำระแล้ว");
      const order = await client.query(`SELECT 1 FROM bms_orders WHERE tenant_id=$1 AND id=$2 AND customer_id=$3 AND status IN ('COMPLETED','RETURNED')`,[input.tenantId,input.orderId,current.rows[0].customer_id]);
      if (!order.rowCount) throw new Error("บิลต้องชำระเสร็จและเป็นของลูกค้าคนเดียวกับนัด");
      orderId=input.orderId;
    }
    await client.query(`UPDATE bms_salon_appointments SET status=$3,order_id=COALESCE($4,order_id),updated_at=now() WHERE tenant_id=$1 AND id=$2`,[input.tenantId,input.appointmentId,input.status,orderId]);
    await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.appointment.status",target:input.appointmentId,meta:{from:current.rows[0].status,to:input.status,orderId}});
    await client.query("COMMIT");
    return {status:input.status};
  } catch(error){try{await client.query("ROLLBACK");}catch{} throw error;} finally{client.release();}
}

export async function upsertSalonServiceSetting(input:{tenantId:string;actorUserId:string;productSku:string;durationMinutes:number;bufferMinutes?:number;onlineBookable?:boolean;active?:boolean}){
  const duration=Math.trunc(input.durationMinutes),buffer=Math.trunc(input.bufferMinutes??0);
  if(duration<5||duration>720||buffer<0||buffer>180) throw new Error("ระยะเวลาบริการ/เวลาพักไม่ถูกต้อง");
  const client=await getClient(); try{
    await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const product=await client.query(`SELECT 1 FROM bms_products p JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku WHERE p.tenant_id=$1 AND p.sku=$2 AND p.active AND sp.stock_policy='NON_STOCK'`,[input.tenantId,input.productSku.trim()]);
    if(!product.rowCount) throw new Error("บริการต้องเป็นสินค้า NON_STOCK ที่เปิดขายอยู่");
    await client.query(`INSERT INTO bms_salon_service_settings(tenant_id,product_sku,duration_minutes,buffer_minutes,online_bookable,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,product_sku) DO UPDATE SET duration_minutes=EXCLUDED.duration_minutes,buffer_minutes=EXCLUDED.buffer_minutes,online_bookable=EXCLUDED.online_bookable,active=EXCLUDED.active,updated_at=now()`,[input.tenantId,input.productSku.trim(),duration,buffer,Boolean(input.onlineBookable),input.active!==false]);
    await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.service.configure",target:input.productSku.trim(),meta:{duration,buffer,onlineBookable:Boolean(input.onlineBookable)}});
    await client.query("COMMIT"); return {status:"SAVED" as const};
  }catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}finally{client.release();}
}

export async function upsertSalonResource(input:{tenantId:string;actorUserId:string;id?:string|null;locationId:string;name:string;resourceType:"CHAIR"|"ROOM"|"BED"|"EQUIPMENT";active?:boolean}){
  const name=input.name.trim(); if(!name||name.length>120) throw new Error("ชื่อทรัพยากรไม่ถูกต้อง");
  if(!(["CHAIR","ROOM","BED","EQUIPMENT"] as const).includes(input.resourceType)) throw new Error("ประเภททรัพยากรไม่ถูกต้อง");
  const client=await getClient(); try{await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const loc=await client.query(`SELECT 1 FROM bms_locations WHERE tenant_id=$1 AND id=$2`,[input.tenantId,input.locationId]); if(!loc.rowCount) throw new Error("ไม่พบสาขา");
    const row= input.id ? await client.query<{id:string}>(`UPDATE bms_salon_resources SET name=$4,resource_type=$5,active=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND location_id=$3 RETURNING id`,[input.tenantId,input.id,input.locationId,name,input.resourceType,input.active!==false]) : await client.query<{id:string}>(`INSERT INTO bms_salon_resources(tenant_id,location_id,name,resource_type,active) VALUES($1,$2,$3,$4,$5) RETURNING id`,[input.tenantId,input.locationId,name,input.resourceType,input.active!==false]);
    if(!row.rowCount) throw new Error("ไม่พบทรัพยากร"); await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.resource.save",target:row.rows[0].id}); await client.query("COMMIT"); return {status:"SAVED" as const,id:row.rows[0].id};
  }catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}finally{client.release();}
}

export async function upsertSalonClientProfile(input:{tenantId:string;actorUserId:string;customerId:string;allergyNotes?:string|null;formulaNotes?:string|null;preferenceNotes?:string|null;photoConsent?:boolean;marketingConsent?:boolean}){
  const client=await getClient(); try{await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const customer=await client.query(`SELECT 1 FROM bms_customers WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,[input.tenantId,input.customerId]); if(!customer.rowCount) throw new Error("ไม่พบลูกค้า");
    const clean=(v:string|null|undefined)=>v?.trim().slice(0,5000)||null;
    await client.query(`INSERT INTO bms_salon_client_profiles(tenant_id,customer_id,allergy_notes,formula_notes,preference_notes,photo_consent,marketing_consent,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,customer_id) DO UPDATE SET allergy_notes=EXCLUDED.allergy_notes,formula_notes=EXCLUDED.formula_notes,preference_notes=EXCLUDED.preference_notes,photo_consent=EXCLUDED.photo_consent,marketing_consent=EXCLUDED.marketing_consent,updated_by=EXCLUDED.updated_by,updated_at=now()`,[input.tenantId,input.customerId,clean(input.allergyNotes),clean(input.formulaNotes),clean(input.preferenceNotes),Boolean(input.photoConsent),Boolean(input.marketingConsent),input.actorUserId]);
    await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.client_profile.update",target:input.customerId,meta:{photoConsent:Boolean(input.photoConsent),marketingConsent:Boolean(input.marketingConsent)}}); await client.query("COMMIT"); return {status:"SAVED" as const};
  }catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}finally{client.release();}
}

export async function listSalonClientCare(tenantId:string,customerId:string){
  const [profile,packages]=await Promise.all([
    query<any>(`SELECT allergy_notes,formula_notes,preference_notes,photo_consent,marketing_consent,updated_at FROM bms_salon_client_profiles WHERE tenant_id=$1 AND customer_id=$2`,[tenantId,customerId]),
    query<any>(`SELECT cp.id,pp.name,pp.service_product_sku,cp.total_uses,cp.expires_at,cp.status,
      cp.total_uses+COALESCE(SUM(l.delta_uses),0)::int AS remaining_uses
      FROM bms_salon_customer_packages cp JOIN bms_salon_package_plans pp ON pp.tenant_id=cp.tenant_id AND pp.id=cp.plan_id
      LEFT JOIN bms_salon_package_ledger l ON l.tenant_id=cp.tenant_id AND l.customer_package_id=cp.id
      WHERE cp.tenant_id=$1 AND cp.customer_id=$2 GROUP BY cp.id,pp.name,pp.service_product_sku ORDER BY cp.created_at DESC`,[tenantId,customerId]),
  ]); return {profile:profile.rows[0]??null,packages:packages.rows};
}

export async function saveSalonPackagePlan(input:{tenantId:string;actorUserId:string;id?:string|null;name:string;saleProductSku:string;serviceProductSku:string;totalUses:number;validityDays:number;active?:boolean}){
  const uses=Math.trunc(input.totalUses),days=Math.trunc(input.validityDays),name=input.name.trim();
  if(!name||name.length>120||uses<1||uses>1000||days<1||days>3650) throw new Error("ข้อมูลแพ็กเกจไม่ถูกต้อง");
  const client=await getClient(); try{await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const products=await client.query<{sku:string}>(`SELECT p.sku FROM bms_products p JOIN bms_product_stock_policies sp ON sp.tenant_id=p.tenant_id AND sp.product_sku=p.sku WHERE p.tenant_id=$1 AND p.sku=ANY($2::text[]) AND p.active AND sp.stock_policy='NON_STOCK'`,[input.tenantId,[input.saleProductSku,input.serviceProductSku]]);
    if(new Set(products.rows.map(r=>r.sku)).size!==new Set([input.saleProductSku,input.serviceProductSku]).size) throw new Error("SKU ขายแพ็กเกจและ SKU บริการต้องเป็น NON_STOCK ที่เปิดใช้งาน");
    const row=input.id?await client.query<{id:string}>(`UPDATE bms_salon_package_plans SET name=$3,sale_product_sku=$4,service_product_sku=$5,total_uses=$6,validity_days=$7,active=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id`,[input.tenantId,input.id,name,input.saleProductSku,input.serviceProductSku,uses,days,input.active!==false]):await client.query<{id:string}>(`INSERT INTO bms_salon_package_plans(tenant_id,name,sale_product_sku,service_product_sku,total_uses,validity_days,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[input.tenantId,name,input.saleProductSku,input.serviceProductSku,uses,days,input.active!==false]);
    if(!row.rowCount) throw new Error("ไม่พบแพ็กเกจ"); await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.package_plan.save",target:row.rows[0].id}); await client.query("COMMIT"); return {status:"SAVED" as const,id:row.rows[0].id};
  }catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}finally{client.release();}
}

export async function activateSalonPackageFromSale(input:{tenantId:string;actorUserId:string;planId:string;customerId:string;orderItemId:number}){
  if(!Number.isSafeInteger(input.orderItemId)||input.orderItemId<1) throw new Error("orderItemId ไม่ถูกต้อง");
  const client=await getClient(); try{await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const evidence=await client.query<any>(`SELECT pp.total_uses,pp.validity_days,oi.order_id,oi.id AS order_item_id,
      GREATEST(COALESCE(oi.pack_qty,oi.qty)-COALESCE((
        SELECT SUM(COALESCE(ri.pack_qty,ri.qty)) FROM bms_pos_return_items ri
        JOIN bms_pos_returns pr ON pr.tenant_id=ri.tenant_id AND pr.id=ri.pos_return_id
        WHERE ri.tenant_id=oi.tenant_id AND ri.order_item_id=oi.id AND pr.is_void=FALSE
      ),0),0)::int AS quantity
      FROM bms_salon_package_plans pp JOIN bms_order_items oi ON oi.tenant_id=pp.tenant_id AND oi.product_sku=pp.sale_product_sku
      JOIN bms_orders o ON o.tenant_id=oi.tenant_id AND o.id=oi.order_id
      WHERE pp.tenant_id=$1 AND pp.id=$2 AND pp.active AND oi.id=$3 AND o.customer_id=$4 AND o.status IN('COMPLETED','RETURNED') FOR UPDATE OF oi`,[input.tenantId,input.planId,input.orderItemId,input.customerId]);
    if(!evidence.rowCount||Number(evidence.rows[0].quantity)<1) throw new Error("ไม่พบบิลแพ็กเกจที่ชำระแล้วและยังไม่คืนของลูกค้ารายนี้"); const e=evidence.rows[0];
    const row=await client.query<{id:string}>(`WITH inserted AS (
      INSERT INTO bms_salon_customer_packages(tenant_id,plan_id,customer_id,source_order_id,source_order_item_id,total_uses,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+($7::int*interval '1 day'))
      ON CONFLICT(tenant_id,source_order_item_id) DO NOTHING RETURNING id
    ) SELECT id FROM inserted UNION ALL
      SELECT id FROM bms_salon_customer_packages WHERE tenant_id=$1 AND source_order_item_id=$5 LIMIT 1`,[input.tenantId,input.planId,input.customerId,e.order_id,e.order_item_id,Number(e.total_uses)*Number(e.quantity),e.validity_days]);
    await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.package.activate",target:row.rows[0].id,meta:{orderItemId:input.orderItemId}}); await client.query("COMMIT"); return {status:"ACTIVE" as const,id:row.rows[0].id};
  }catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}finally{client.release();}
}

export async function redeemSalonPackageUse(input:{tenantId:string;actorUserId:string;customerPackageId:string;appointmentServiceId:string}){
  const client=await getClient(); try{await beginTenantTx(client,input.tenantId,{editorId:input.actorUserId});
    const entitlement=await client.query<any>(`SELECT cp.total_uses,cp.status,cp.expires_at,pp.service_product_sku,s.product_sku,
      cp.total_uses+COALESCE((SELECT SUM(delta_uses) FROM bms_salon_package_ledger WHERE tenant_id=cp.tenant_id AND customer_package_id=cp.id),0)::int AS remaining
      FROM bms_salon_customer_packages cp JOIN bms_salon_package_plans pp ON pp.tenant_id=cp.tenant_id AND pp.id=cp.plan_id
      JOIN bms_salon_appointment_services s ON s.tenant_id=cp.tenant_id AND s.id=$3
      JOIN bms_salon_appointments a ON a.tenant_id=s.tenant_id AND a.id=s.appointment_id AND a.customer_id=cp.customer_id
      WHERE cp.tenant_id=$1 AND cp.id=$2 FOR UPDATE OF cp`,[input.tenantId,input.customerPackageId,input.appointmentServiceId]);
    const e=entitlement.rows[0]; if(!e||e.status!=="ACTIVE"||Date.parse(e.expires_at)<=Date.now()||e.service_product_sku!==e.product_sku||Number(e.remaining)<1) throw new Error("แพ็กเกจนี้ใช้กับบริการไม่ได้หรือสิทธิ์ไม่เพียงพอ");
    await client.query(`INSERT INTO bms_salon_package_ledger(tenant_id,customer_package_id,appointment_service_id,delta_uses,reason,actor_user_id) VALUES($1,$2,$3,-1,'ใช้บริการตามนัด',$4)`,[input.tenantId,input.customerPackageId,input.appointmentServiceId,input.actorUserId]);
    if(Number(e.remaining)===1) await client.query(`UPDATE bms_salon_customer_packages SET status='EXHAUSTED' WHERE tenant_id=$1 AND id=$2`,[input.tenantId,input.customerPackageId]);
    await auditInTx(client,{tenantId:input.tenantId,actorUserId:input.actorUserId,action:"salon.package.redeem",target:input.customerPackageId,meta:{appointmentServiceId:input.appointmentServiceId}}); await client.query("COMMIT"); return {status:"REDEEMED" as const,remainingUses:Number(e.remaining)-1};
  }catch(error){try{await client.query("ROLLBACK");}catch{} throw error;}finally{client.release();}
}
