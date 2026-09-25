import "server-only";
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { getClient, query } from "@/lib/db";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[a-f0-9]{64}$/;
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_64 = /^[A-Za-z0-9_-]{86}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const EVENT_TYPES = new Set([
  "INSTALLATION_REGISTERED", "RUNTIME_SEEN", "UPDATE_INSTALLED",
  "TRANSFER_REQUESTED", "INSTALLATION_DEACTIVATED",
]);

export class RetailLocalLicenseError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 404 | 409 = 400) {
    super(message);
  }
}

export type LicenseEvidenceEvent = {
  formatVersion: 1;
  eventId: string;
  eventType: string;
  licenseId: string;
  installationId: string;
  tenantId?: string;
  posDeviceId?: string;
  platformTarget: string;
  releaseVersion: string;
  agentVersion: string;
  occurredAt: string;
  sequence: number;
  previousEventHash?: string;
  deviceKeyThumbprint: string;
};

export type LicenseEvidenceEnvelope = {
  formatVersion: 1;
  event: LicenseEvidenceEvent;
  eventHash: string;
  devicePublicKey: string;
  signature: string;
};

function exactKeys(value: Record<string, unknown>, allowed: string[], required: string[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new RetailLocalLicenseError(`field ไม่รองรับ: ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) throw new RetailLocalLicenseError(`ขาด field: ${key}`);
  }
}

function stringField(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new RetailLocalLicenseError(`${name} ไม่ถูกต้อง`);
  }
  return value;
}

function decodeBase64Url(value: string, expectedLength: number): Buffer {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedLength || decoded.toString("base64url") !== value) {
    throw new RetailLocalLicenseError("base64url ไม่ถูกต้อง");
  }
  return decoded;
}

export function verifyRetailLocalLicenseEnvelope(input: unknown): LicenseEvidenceEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RetailLocalLicenseError("license evidence ต้องเป็น object");
  }
  const envelope = input as Record<string, unknown>;
  exactKeys(envelope, ["formatVersion", "event", "eventHash", "devicePublicKey", "signature"],
    ["formatVersion", "event", "eventHash", "devicePublicKey", "signature"]);
  if (envelope.formatVersion !== 1 || !envelope.event || typeof envelope.event !== "object" || Array.isArray(envelope.event)) {
    throw new RetailLocalLicenseError("license evidence version/event ไม่ถูกต้อง");
  }
  const raw = envelope.event as Record<string, unknown>;
  const allowed = ["formatVersion", "eventId", "eventType", "licenseId", "installationId", "tenantId",
    "posDeviceId", "platformTarget", "releaseVersion", "agentVersion", "occurredAt", "sequence",
    "previousEventHash", "deviceKeyThumbprint"];
  exactKeys(raw, allowed, allowed.filter((key) => !["tenantId", "posDeviceId", "previousEventHash"].includes(key)));
  if (raw.formatVersion !== 1) throw new RetailLocalLicenseError("event formatVersion ไม่ถูกต้อง");
  const occurredAt = stringField(raw.occurredAt, "occurredAt", /^\d{4}-\d{2}-\d{2}T/);
  if (!Number.isFinite(Date.parse(occurredAt))) throw new RetailLocalLicenseError("occurredAt ไม่ถูกต้อง");
  if (!Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 1) {
    throw new RetailLocalLicenseError("sequence ไม่ถูกต้อง");
  }
  const event: LicenseEvidenceEvent = {
    formatVersion: 1,
    eventId: stringField(raw.eventId, "eventId", UUID),
    eventType: stringField(raw.eventType, "eventType", ID),
    licenseId: stringField(raw.licenseId, "licenseId", ID),
    installationId: stringField(raw.installationId, "installationId", UUID),
    ...(raw.tenantId === undefined ? {} : { tenantId: stringField(raw.tenantId, "tenantId", ID) }),
    ...(raw.posDeviceId === undefined ? {} : { posDeviceId: stringField(raw.posDeviceId, "posDeviceId", ID) }),
    platformTarget: stringField(raw.platformTarget, "platformTarget", ID),
    releaseVersion: stringField(raw.releaseVersion, "releaseVersion", ID),
    agentVersion: stringField(raw.agentVersion, "agentVersion", ID),
    occurredAt,
    sequence: Number(raw.sequence),
    ...(raw.previousEventHash === undefined ? {} : {
      previousEventHash: stringField(raw.previousEventHash, "previousEventHash", HEX_64),
    }),
    deviceKeyThumbprint: stringField(raw.deviceKeyThumbprint, "deviceKeyThumbprint", HEX_64),
  };
  if (!EVENT_TYPES.has(event.eventType)) throw new RetailLocalLicenseError("eventType ไม่รองรับ");
  const eventBytes = Buffer.from(JSON.stringify(event));
  const eventHash = stringField(envelope.eventHash, "eventHash", HEX_64);
  if (crypto.createHash("sha256").update(eventBytes).digest("hex") !== eventHash) {
    throw new RetailLocalLicenseError("eventHash ไม่ตรงกับ event");
  }
  const devicePublicKey = stringField(envelope.devicePublicKey, "devicePublicKey", BASE64URL_32);
  const publicKeyBytes = decodeBase64Url(devicePublicKey, 32);
  if (crypto.createHash("sha256").update(publicKeyBytes).digest("hex") !== event.deviceKeyThumbprint) {
    throw new RetailLocalLicenseError("device key thumbprint ไม่ตรง");
  }
  const signature = stringField(envelope.signature, "signature", BASE64URL_64);
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKeyBytes]);
  const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
  if (!crypto.verify(null, eventBytes, key, decodeBase64Url(signature, 64))) {
    throw new RetailLocalLicenseError("signature ไม่ถูกต้อง");
  }
  return { formatVersion: 1, event, eventHash, devicePublicKey, signature };
}

async function openReview(client: PoolClient, licenseId: string, installationId: string | null,
  eventId: string | null, reason: string) {
  await client.query(
    `INSERT INTO bms_retail_local_license_reviews
       (license_id, installation_id, event_id, reason)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (license_id, installation_id, reason) WHERE status = 'OPEN' DO NOTHING`,
    [licenseId, installationId, eventId, reason]
  );
  await client.query(
    `UPDATE bms_retail_local_licenses SET status = 'REVIEW_REQUIRED', updated_at = now() WHERE id = $1`,
    [licenseId]
  );
}

export async function ingestRetailLocalLicenseEvidence(rawToken: string, input: unknown) {
  if (!TOKEN.test(rawToken)) throw new RetailLocalLicenseError("unauthorized", 401);
  const envelope = verifyRetailLocalLicenseEnvelope(input);
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const credential = await client.query<{
      token_id: string; license_id: string; license_code: string; license_status: string; max_active_installations: number;
    }>(
      `SELECT t.id AS token_id, l.id AS license_id, l.license_code,
              l.status AS license_status, l.max_active_installations
       FROM bms_retail_local_license_tokens t
       JOIN bms_retail_local_licenses l ON l.id = t.license_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL
       FOR UPDATE OF t, l`,
      [tokenHash]
    );
    const auth = credential.rows[0];
    if (!auth || auth.license_code !== envelope.event.licenseId) {
      throw new RetailLocalLicenseError("unauthorized", 401);
    }
    const duplicate = await client.query<{ event_hash: string; verification_status: string }>(
      `SELECT event_hash, verification_status FROM bms_retail_local_license_events WHERE event_id = $1`,
      [envelope.event.eventId]
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].event_hash !== envelope.eventHash) {
        throw new RetailLocalLicenseError("event id ถูกใช้กับหลักฐานคนละชุด", 409);
      }
      await client.query("COMMIT");
      return { accepted: true, duplicate: true, reviewRequired: duplicate.rows[0].verification_status === "REVIEW_REQUIRED" };
    }

    const installationResult = await client.query<{
      license_id: string; device_key_thumbprint: string; device_public_key: string; status: string;
      last_sequence: string; last_event_hash: string | null;
    }>(
      `SELECT license_id, device_key_thumbprint, device_public_key, status,
              last_sequence::text, last_event_hash
       FROM bms_retail_local_license_installations
       WHERE installation_id = $1 FOR UPDATE`,
      [envelope.event.installationId]
    );
    const installation = installationResult.rows[0];
    let reviewReason: string | null = auth.license_status === "CLOSED" ? "LICENSE_CLOSED" : null;
    if (installation) {
      if (installation.license_id !== auth.license_id) reviewReason = "INSTALLATION_LICENSE_CONFLICT";
      else if (installation.device_key_thumbprint !== envelope.event.deviceKeyThumbprint ||
          installation.device_public_key !== envelope.devicePublicKey) reviewReason = "DEVICE_KEY_CONFLICT";
      else if (Number(installation.last_sequence) + 1 !== envelope.event.sequence ||
          (installation.last_event_hash ?? "") !== (envelope.event.previousEventHash ?? "")) {
        reviewReason = "EVENT_CHAIN_CONFLICT";
      }
    } else if (envelope.event.sequence !== 1 || envelope.event.previousEventHash) {
      reviewReason = "EVENT_CHAIN_MISSING_START";
    } else {
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM bms_retail_local_license_installations
         WHERE license_id = $1 AND status = 'ACTIVE'`,
        [auth.license_id]
      );
      if (Number(active.rows[0]?.count ?? 0) >= auth.max_active_installations) {
        reviewReason = "ACTIVE_INSTALLATION_LIMIT";
      }
    }

    const verification = reviewReason ? "REVIEW_REQUIRED" : "ACCEPTED";
    await client.query(
      `INSERT INTO bms_retail_local_license_events
         (event_id, license_id, installation_id, event_type, sequence, previous_event_hash,
          event_hash, occurred_at, platform_target, release_version, verification_status,
          review_reason, envelope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [envelope.event.eventId, auth.license_id, envelope.event.installationId, envelope.event.eventType,
        envelope.event.sequence, envelope.event.previousEventHash ?? null, envelope.eventHash,
        envelope.event.occurredAt, envelope.event.platformTarget, envelope.event.releaseVersion,
        verification, reviewReason, JSON.stringify(envelope)]
    );

    if (!installation) {
      await client.query(
        `INSERT INTO bms_retail_local_license_installations
           (installation_id, license_id, device_key_thumbprint, device_public_key,
            tenant_reference, pos_device_reference, platform_target, release_version,
            status, last_sequence, last_event_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [envelope.event.installationId, auth.license_id, envelope.event.deviceKeyThumbprint,
          envelope.devicePublicKey, envelope.event.tenantId ?? null, envelope.event.posDeviceId ?? null,
          envelope.event.platformTarget, envelope.event.releaseVersion,
          reviewReason ? "REVIEW_REQUIRED" : "ACTIVE", envelope.event.sequence, envelope.eventHash]
      );
    } else if (!reviewReason) {
      const nextStatus = envelope.event.eventType === "INSTALLATION_DEACTIVATED" ? "DEACTIVATED" : installation.status;
      await client.query(
        `UPDATE bms_retail_local_license_installations
         SET tenant_reference = $2, pos_device_reference = $3, platform_target = $4,
             release_version = $5, status = $6::varchar, last_sequence = $7, last_event_hash = $8,
             last_seen_at = now(), deactivated_at = CASE WHEN $6::varchar = 'DEACTIVATED' THEN now() ELSE deactivated_at END
         WHERE installation_id = $1`,
        [envelope.event.installationId, envelope.event.tenantId ?? null, envelope.event.posDeviceId ?? null,
          envelope.event.platformTarget, envelope.event.releaseVersion, nextStatus,
          envelope.event.sequence, envelope.eventHash]
      );
    } else if (installation.license_id === auth.license_id) {
      await client.query(
        `UPDATE bms_retail_local_license_installations
         SET status = 'REVIEW_REQUIRED', last_seen_at = now() WHERE installation_id = $1`,
        [envelope.event.installationId]
      );
    }
    if (envelope.event.eventType === "TRANSFER_REQUESTED" && !reviewReason) reviewReason = "TRANSFER_REQUESTED";
    if (reviewReason) {
      await openReview(client, auth.license_id, envelope.event.installationId, envelope.event.eventId, reviewReason);
    }
    await client.query(`UPDATE bms_retail_local_license_tokens SET last_used_at = now() WHERE id = $1`, [auth.token_id]);
    await client.query("COMMIT");
    return { accepted: true, duplicate: false, reviewRequired: Boolean(reviewReason) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function newLicenseToken() {
  return `bmslt_${crypto.randomBytes(32).toString("base64url")}`;
}

export async function createRetailLocalLicense(input: {
  customerReference?: string; maxActiveInstallations?: number; adminId: string | number;
}) {
  const customerReference = input.customerReference?.trim() || null;
  if (customerReference && !ID.test(customerReference)) throw new RetailLocalLicenseError("customerReference ไม่ถูกต้อง");
  const maximum = input.maxActiveInstallations ?? 1;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100) {
    throw new RetailLocalLicenseError("maxActiveInstallations ไม่ถูกต้อง");
  }
  const licenseCode = `LIC-${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
  const token = newLicenseToken();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const created = await client.query<{ id: string }>(
      `INSERT INTO bms_retail_local_licenses
         (license_code, customer_reference, max_active_installations, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`, [licenseCode, customerReference, maximum, String(input.adminId)]
    );
    await client.query(
      `INSERT INTO bms_retail_local_license_tokens (license_id, token_hash, issued_by) VALUES ($1,$2,$3)`,
      [created.rows[0].id, tokenHash, String(input.adminId)]
    );
    await client.query("COMMIT");
    return { id: created.rows[0].id, licenseCode, ingestionToken: token, maxActiveInstallations: maximum };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateRetailLocalLicenseToken(licenseId: string, adminId: string | number) {
  if (!UUID.test(licenseId)) throw new RetailLocalLicenseError("license id ไม่ถูกต้อง");
  const token = newLicenseToken();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT id FROM bms_retail_local_licenses WHERE id = $1 FOR UPDATE`, [licenseId]);
    if (!found.rowCount) throw new RetailLocalLicenseError("ไม่พบ license", 404);
    await client.query(`UPDATE bms_retail_local_license_tokens SET revoked_at = now() WHERE license_id = $1 AND revoked_at IS NULL`, [licenseId]);
    await client.query(
      `INSERT INTO bms_retail_local_license_tokens (license_id, token_hash, label, issued_by)
       VALUES ($1,$2,'rotation',$3)`, [licenseId, tokenHash, String(adminId)]
    );
    await client.query("COMMIT");
    return { ingestionToken: token };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listRetailLocalLicenses() {
  const result = await query(
    `SELECT l.id, l.license_code, l.customer_reference, l.status, l.max_active_installations,
            l.created_at, l.updated_at,
            count(DISTINCT i.installation_id)::int AS installation_count,
            count(DISTINCT i.installation_id) FILTER (WHERE i.status = 'ACTIVE')::int AS active_installation_count,
            count(DISTINCT r.id) FILTER (WHERE r.status = 'OPEN')::int AS open_review_count,
            max(i.last_seen_at) AS last_seen_at
     FROM bms_retail_local_licenses l
     LEFT JOIN bms_retail_local_license_installations i ON i.license_id = l.id
     LEFT JOIN bms_retail_local_license_reviews r ON r.license_id = l.id
     GROUP BY l.id ORDER BY l.updated_at DESC LIMIT 500`
  );
  return result.rows;
}

export async function getRetailLocalLicenseDetails(licenseId: string) {
  if (!UUID.test(licenseId)) throw new RetailLocalLicenseError("license id ไม่ถูกต้อง");
  const license = await query(
    `SELECT id, license_code, customer_reference, status, max_active_installations, created_at, updated_at
     FROM bms_retail_local_licenses WHERE id = $1`, [licenseId]
  );
  if (!license.rowCount) throw new RetailLocalLicenseError("ไม่พบ license", 404);
  const [installations, events, reviews] = await Promise.all([
    query(
      `SELECT installation_id, device_key_thumbprint, tenant_reference, pos_device_reference,
              platform_target, release_version, status, last_sequence, first_seen_at, last_seen_at,
              deactivated_at
       FROM bms_retail_local_license_installations WHERE license_id = $1
       ORDER BY last_seen_at DESC`, [licenseId]
    ),
    query(
      `SELECT event_id, installation_id, event_type, sequence, previous_event_hash, event_hash,
              occurred_at, received_at, platform_target, release_version, verification_status, review_reason
       FROM bms_retail_local_license_events WHERE license_id = $1
       ORDER BY received_at DESC LIMIT 2000`, [licenseId]
    ),
    query(
      `SELECT id, installation_id, event_id, reason, status, opened_at, resolved_at, resolved_by, resolution
       FROM bms_retail_local_license_reviews WHERE license_id = $1
       ORDER BY opened_at DESC LIMIT 500`, [licenseId]
    ),
  ]);
  return { license: license.rows[0], installations: installations.rows, events: events.rows, reviews: reviews.rows };
}

export async function resolveRetailLocalLicenseReview(input: {
  licenseId: string;
  installationId: string;
  fromInstallationId?: string;
  action: "APPROVE" | "TRANSFER" | "DEACTIVATE";
  adminId: string | number;
}) {
  if (!UUID.test(input.licenseId) || !UUID.test(input.installationId)) {
    throw new RetailLocalLicenseError("license/installation id ไม่ถูกต้อง");
  }
  if (input.action === "TRANSFER" && (!input.fromInstallationId || !UUID.test(input.fromInstallationId) ||
      input.fromInstallationId === input.installationId)) {
    throw new RetailLocalLicenseError("fromInstallationId ไม่ถูกต้อง");
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const target = await client.query(
      `SELECT installation_id FROM bms_retail_local_license_installations
       WHERE license_id = $1 AND installation_id = $2 FOR UPDATE`, [input.licenseId, input.installationId]
    );
    if (!target.rowCount) throw new RetailLocalLicenseError("ไม่พบ installation", 404);
    if (input.action === "TRANSFER") {
      const transferred = await client.query(
        `UPDATE bms_retail_local_license_installations SET status = 'TRANSFERRED'
         WHERE license_id = $1 AND installation_id = $2 AND status = 'ACTIVE' RETURNING installation_id`,
        [input.licenseId, input.fromInstallationId]
      );
      if (!transferred.rowCount) throw new RetailLocalLicenseError("ไม่พบ active installation ต้นทาง", 409);
    } else if (input.action === "APPROVE") {
      const capacity = await client.query<{ active: string; maximum: number }>(
        `SELECT count(i.installation_id) FILTER (
                  WHERE i.status = 'ACTIVE' AND i.installation_id <> $2
                )::text AS active,
                l.max_active_installations AS maximum
         FROM bms_retail_local_licenses l
         LEFT JOIN bms_retail_local_license_installations i ON i.license_id = l.id
         WHERE l.id = $1 GROUP BY l.id`, [input.licenseId, input.installationId]
      );
      if (Number(capacity.rows[0]?.active ?? 0) >= Number(capacity.rows[0]?.maximum ?? 0)) {
        throw new RetailLocalLicenseError("จำนวน active installation เต็ม; ต้องใช้ TRANSFER", 409);
      }
    }
    const status = input.action === "DEACTIVATE" ? "DEACTIVATED" : "ACTIVE";
    await client.query(
      `UPDATE bms_retail_local_license_installations
       SET status = $3::varchar,
           deactivated_at = CASE WHEN $3::varchar = 'DEACTIVATED' THEN now() ELSE NULL END,
           last_seen_at = now()
       WHERE license_id = $1 AND installation_id = $2`, [input.licenseId, input.installationId, status]
    );
    await client.query(
      `UPDATE bms_retail_local_license_reviews
       SET status = 'RESOLVED', resolved_at = now(), resolved_by = $3, resolution = $4
       WHERE license_id = $1 AND installation_id = $2 AND status = 'OPEN'`,
      [input.licenseId, input.installationId, input.adminId, input.action]
    );
    await client.query(
      `UPDATE bms_retail_local_licenses l SET status = CASE WHEN EXISTS (
         SELECT 1 FROM bms_retail_local_license_reviews r WHERE r.license_id = l.id AND r.status = 'OPEN'
       ) THEN 'REVIEW_REQUIRED' ELSE 'ACTIVE' END, updated_at = now() WHERE l.id = $1`,
      [input.licenseId]
    );
    await client.query("COMMIT");
    return { ok: true, status };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
