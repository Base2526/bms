import crypto from "node:crypto";

function hashUtf8(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalizeMigrationSql(sql) {
  return sql.replace(/\r\n?/g, "\n");
}

export function migrationChecksum(sql) {
  return hashUtf8(canonicalizeMigrationSql(sql));
}

export function compatibleMigrationChecksums(sql) {
  const canonical = canonicalizeMigrationSql(sql);
  return new Set([
    hashUtf8(canonical),
    hashUtf8(sql),
    hashUtf8(canonical.replace(/\n/g, "\r\n")),
  ]);
}
