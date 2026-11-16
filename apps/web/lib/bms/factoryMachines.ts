import { checklistPermission, checklistTx, type ChecklistScope } from "./operationChecklists";
import { ChecklistError, checklistText, checklistUuid, rejectChecklist as reject } from "./operationChecklistPolicy";
import { teamBranches, teamHash } from "./operationTeamReads";

export type FactoryMachineInput = {
  id?: string;
  version?: number;
  locationId: string;
  code: string;
  name: string;
  active: boolean;
  confirmed: boolean;
  idempotencyKey: string;
};

export async function factoryMachines(s: ChecklistScope, locationId: string, search = "") {
  checklistPermission(s, "operations.production.manage");
  const term = checklistText(search, 120);
  return checklistTx(s, async (c) => {
    await teamBranches(c, s, locationId);
    const rows = (await c.query(
      `SELECT id,location_id,code,name,active,version FROM bms_factory_machines
       WHERE tenant_id=$1 AND location_id=$2
         AND ($3='' OR position(lower($3) in lower(code||' '||name))>0)
       ORDER BY code LIMIT 101`,
      [s.tenantId, locationId, term],
    )).rows;
    return { rows: rows.slice(0, 100), truncated: rows.length > 100 };
  });
}

export async function saveFactoryMachine(s: ChecklistScope, input: FactoryMachineInput) {
  try {
    checklistPermission(s, "operations.production.manage");
    if (input.confirmed !== true) return reject("CONFIRMATION_REQUIRED");
    if (!checklistUuid(input.locationId) || typeof input.active !== "boolean")
      return reject("INVALID_INPUT");
    const code = checklistText(input.code, 40, true).toUpperCase();
    const name = checklistText(input.name, 120, true);
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) return reject("INVALID_INPUT");
    const key = `factory-machine:${checklistText(input.idempotencyKey, 128, true)}`;
    const fingerprint = teamHash({ ...input, code, name });
    return await checklistTx(s, async (c) => {
      await teamBranches(c, s, input.locationId);
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
        `${s.tenantId}:${s.actorId}:${key}`,
      ]);
      const prior = (await c.query(
        `SELECT fingerprint,result FROM bms_operation_commands
         WHERE tenant_id=$1 AND actor=$2 AND key=$3`,
        [s.tenantId, s.actorId, key],
      )).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) return reject("IDEMPOTENCY_CONFLICT");
        return prior.result;
      }
      let row: { id: string; version: number };
      if (input.id) {
        if (!checklistUuid(input.id)) return reject("INVALID_INPUT");
        const old = (await c.query(
          `SELECT code,version FROM bms_factory_machines
           WHERE tenant_id=$1 AND location_id=$2 AND id=$3 FOR UPDATE`,
          [s.tenantId, input.locationId, input.id],
        )).rows[0];
        if (!old) return reject("NOT_FOUND");
        if (old.version !== input.version) return reject("STALE_VERSION");
        if (old.code !== code) return reject("MACHINE_CODE_IMMUTABLE");
        row = (await c.query(
          `UPDATE bms_factory_machines SET name=$4,active=$5,version=version+1,updated_at=now()
           WHERE tenant_id=$1 AND location_id=$2 AND id=$3 RETURNING id,version`,
          [s.tenantId, input.locationId, input.id, name, input.active],
        )).rows[0];
      } else {
        const existing = await c.query(
          `SELECT 1 FROM bms_factory_machines WHERE tenant_id=$1 AND location_id=$2 AND code=$3`,
          [s.tenantId, input.locationId, code],
        );
        if (existing.rowCount) return reject("MACHINE_EXISTS");
        row = (await c.query(
          `INSERT INTO bms_factory_machines
           (tenant_id,location_id,code,name,active,created_by)
           VALUES($1,$2,$3,$4,$5,$6) RETURNING id,version`,
          [s.tenantId, input.locationId, code, name, input.active, s.actorId],
        )).rows[0];
      }
      await c.query(
        `INSERT INTO bms_audit_log(tenant_id,actor,action,target,meta)
         VALUES($1,$2,'factory.machine.save',$3,$4::jsonb)`,
        [s.tenantId, s.actorId, row.id, JSON.stringify({ code, name, active: input.active })],
      );
      const result = { status: "OK", ...row };
      await c.query(
        `INSERT INTO bms_operation_commands(tenant_id,actor,key,fingerprint,result)
         VALUES($1,$2,$3,$4,$5::jsonb)`,
        [s.tenantId, s.actorId, key, fingerprint, JSON.stringify(result)],
      );
      return result;
    });
  } catch (e) {
    if (e instanceof ChecklistError) return { status: e.status };
    if (["40001", "40P01"].includes((e as any)?.code)) return { status: "RETRY_REQUIRED" };
    if ((e as any)?.code === "23505") return { status: "MACHINE_EXISTS" };
    throw e;
  }
}
