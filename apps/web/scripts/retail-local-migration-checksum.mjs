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

// 10.121 originally shipped without transaction-local timeouts. Existing
// installations that applied that exact SQL must remain upgradeable after the
// operational timeout is added to the same ordered migration. Both hashes are
// for that one historical file (LF and CRLF), never a generic drift bypass.
const PRE_TIMEOUT_OWNER_REPAIR_CHECKSUMS = new Set([
  "834706e8390c13c07283f74587163d32dc3c51eb83e7e5de58c36767b46a265b",
  "87752a54c487a979deadf1c5df210a5e03b2eaefce906f088bea4c94fb7cc9fc",
]);

export function previouslyAppliedMigrationChecksums(name) {
  return name === "10.121__bms_verified_shop_owner_administrator.sql"
    ? new Set(PRE_TIMEOUT_OWNER_REPAIR_CHECKSUMS)
    : new Set();
}
