#!/usr/bin/env python3

"""Build bootstrap schema SQL from db/migrations/*.sql.

Outputs:
- db/schema_full.sql
- (optional) db/schema_core.sql, db/schema_auth.sql, db/schema_scam.sql, db/schema_social.sql

Behavior:
- Sorts migrations numerically by prefix: 1.2 < 1.10 < 1.20
- Concatenates with section headers per migration
- Strips per-migration BEGIN/COMMIT/ROLLBACK/START TRANSACTION lines (line-only)
  to avoid nested transactions, then wraps final output in single BEGIN/COMMIT
- Tries to reduce duplicate-object errors by upgrading:
    CREATE EXTENSION -> CREATE EXTENSION IF NOT EXISTS
    CREATE TABLE     -> CREATE TABLE IF NOT EXISTS
    CREATE INDEX     -> CREATE INDEX IF NOT EXISTS
  (only when the statement doesn't already include IF NOT EXISTS)

This script uses only the Python stdlib.
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Tuple, Dict


@dataclass(frozen=True)
class Migration:
    file_name: str
    abs_path: Path
    rel_path: str
    version_raw: str
    version_parts: Tuple[int, ...]
    category: str  # core|auth|scam|social


TXN_LINE_RE = re.compile(r"^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;\s*$", re.IGNORECASE)

CREATE_EXT_RE = re.compile(r"(^\s*CREATE\s+EXTENSION\s+)(?!IF\s+NOT\s+EXISTS\b)", re.IGNORECASE | re.MULTILINE)
CREATE_TABLE_RE = re.compile(r"(^\s*CREATE\s+TABLE\s+)(?!IF\s+NOT\s+EXISTS\b)", re.IGNORECASE | re.MULTILINE)
CREATE_INDEX_RE = re.compile(r"(^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+)(?!IF\s+NOT\s+EXISTS\b)", re.IGNORECASE | re.MULTILINE)

CONCURRENTLY_RE = re.compile(r"\bCREATE\s+INDEX\s+CONCURRENTLY\b", re.IGNORECASE)


def parse_version(file_name: str) -> Tuple[str, Tuple[int, ...]]:
    base = os.path.basename(file_name)
    prefix = base.split("__", 1)[0]
    parts: List[int] = []
    for seg in prefix.split("."):
        seg = seg.strip()
        if not seg:
            continue
        try:
            parts.append(int(seg))
        except ValueError:
            # keep parsing best-effort; non-numeric segments just omitted
            pass
    return prefix, tuple(parts)


def version_key(parts: Tuple[int, ...]) -> Tuple[int, ...]:
    # Compare lexicographically, treating missing segments as 0.
    # We normalize to a fixed length to avoid weird comparisons.
    max_len = 4
    padded = list(parts[:max_len]) + [0] * (max_len - len(parts))
    return tuple(padded)


def classify_category(file_name: str) -> str:
    lower = file_name.lower()

    if re.search(r"(scam|fraud|phone|bank|money_mule|mule)", lower):
        return "scam"
    if re.search(r"(user|users|session|sessions|role|roles|auth|password|reset|verify|email)", lower):
        return "auth"
    if re.search(
        r"(post|posts|comment|comments|bookmark|bookmarks|message|messages|chat|dm|notification|notifications|social|file|files|image|images)",
        lower,
    ):
        return "social"
    return "core"


def strip_per_migration_transactions(sql: str) -> Tuple[str, bool]:
    lines = sql.splitlines()
    out: List[str] = []
    stripped = False
    for line in lines:
        if TXN_LINE_RE.match(line):
            stripped = True
            continue
        out.append(line)
    return "\n".join(out) + ("\n" if sql.endswith("\n") else ""), stripped


def upgrade_if_not_exists(sql: str) -> Tuple[str, bool]:
    changed = False

    def _ext(m: re.Match[str]) -> str:
        nonlocal changed
        changed = True
        return m.group(1) + "IF NOT EXISTS "

    def _tbl(m: re.Match[str]) -> str:
        nonlocal changed
        changed = True
        return m.group(1) + "IF NOT EXISTS "

    def _idx(m: re.Match[str]) -> str:
        nonlocal changed
        changed = True
        return m.group(1) + "IF NOT EXISTS "

    sql2 = CREATE_EXT_RE.sub(_ext, sql)
    sql2 = CREATE_TABLE_RE.sub(_tbl, sql2)
    sql2 = CREATE_INDEX_RE.sub(_idx, sql2)

    return sql2, changed


def section_header(file_name: str) -> str:
    return (
        "-- =====================================================\n"
        f"-- MIGRATION: {file_name}\n"
        "-- =====================================================\n\n"
    )


def file_header(out_rel: str, generated_at: str, included: List[str]) -> str:
    lines = [
        "-- =============================================",
        "-- AUTO-GENERATED SCHEMA FILE (DO NOT EDIT)",
        f"-- Output: {out_rel}",
        f"-- GeneratedAt: {generated_at}",
        "-- Included migrations:",
    ]
    lines.extend([f"--  - {f}" for f in included])
    lines.append("-- =============================================")
    return "\n".join(lines) + "\n\n"


def read_utf8(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def write_utf8(p: Path, s: str) -> None:
    p.write_text(s, encoding="utf-8")


def load_migrations(repo_root: Path) -> Tuple[List[Migration], List[str]]:
    mig_dir = repo_root / "db" / "migrations"
    if not mig_dir.exists():
        raise RuntimeError(f"Missing migrations dir: {mig_dir}")

    warnings: List[str] = []
    file_names = [f.name for f in mig_dir.iterdir() if f.is_file() and f.name.lower().endswith(".sql")]
    if not file_names:
        raise RuntimeError(f"No .sql files found in {mig_dir}")

    prefix_map: Dict[str, List[str]] = {}
    migrations: List[Migration] = []

    for fn in file_names:
        abs_path = mig_dir / fn
        rel_path = str(Path("db") / "migrations" / fn).replace(os.sep, "/")
        version_raw, parts = parse_version(fn)
        cat = classify_category(fn)

        prefix_map.setdefault(version_raw, []).append(rel_path)
        migrations.append(
            Migration(
                file_name=fn,
                abs_path=abs_path,
                rel_path=rel_path,
                version_raw=version_raw,
                version_parts=parts,
                category=cat,
            )
        )

    for pref, files in prefix_map.items():
        if len(files) > 1:
            warnings.append(f"Duplicate migration prefix '{pref}': {', '.join(files)}")

    migrations.sort(key=lambda m: (version_key(m.version_parts), m.file_name))
    return migrations, warnings


def build_schema_file(out_path: Path, out_rel: str, migrations: List[Migration]) -> Tuple[List[str], int, int]:
    warnings: List[str] = []
    stripped_count = 0
    upgraded_count = 0

    generated_at = datetime.now(timezone.utc).isoformat()
    included = [m.file_name for m in migrations]

    parts: List[str] = []
    parts.append(file_header(out_rel=out_rel, generated_at=generated_at, included=included))
    parts.append("BEGIN;\n\n")

    for m in migrations:
        raw = read_utf8(m.abs_path)

        if CONCURRENTLY_RE.search(raw):
            warnings.append(
                f"Found CREATE INDEX CONCURRENTLY in {m.rel_path}; this cannot run inside a transaction (BEGIN/COMMIT)."
            )

        stripped_sql, stripped = strip_per_migration_transactions(raw)
        if stripped:
            stripped_count += 1

        upgraded_sql, upgraded = upgrade_if_not_exists(stripped_sql)
        if upgraded:
            upgraded_count += 1

        parts.append(section_header(m.file_name))
        parts.append(upgraded_sql if upgraded_sql.endswith("\n") else upgraded_sql + "\n")
        parts.append("\n")

    parts.append("COMMIT;\n")

    write_utf8(out_path, "".join(parts))
    return warnings, stripped_count, upgraded_count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--categorized", action="store_true", help="Also emit categorized schema files")
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    migrations, warnings = load_migrations(repo_root)

    out_full = repo_root / "db" / "schema_full.sql"

    print(f"[schema] repo_root: {repo_root}")
    print(f"[schema] migrations: {len(migrations)}")
    print(f"[schema] out: {out_full}")

    w2, stripped_count, upgraded_count = build_schema_file(
        out_path=out_full, out_rel="db/schema_full.sql", migrations=migrations
    )
    warnings.extend(w2)

    if args.categorized:
        by_cat: Dict[str, List[Migration]] = {"core": [], "auth": [], "scam": [], "social": []}
        for m in migrations:
            by_cat[m.category].append(m)

        cat_outs = [
            ("core", repo_root  / "schema_core.sql"),
            ("auth", repo_root / "schema_auth.sql"),
            ("scam", repo_root / "schema_scam.sql"),
            ("social", repo_root / "schema_social.sql"),
        ]

        for cat, outp in cat_outs:
            if not by_cat[cat]:
                continue
            print(f"[schema] out: {outp} ({cat}, {len(by_cat[cat])} migrations)")
            w_cat, _, _ = build_schema_file(out_path=outp, out_rel=f"schema_{cat}.sql", migrations=by_cat[cat])
            warnings.extend([f"schema_{cat}.sql: {w}" for w in w_cat])

    print(f"[schema] stripped per-migration TXN wrappers: {stripped_count}")
    print(f"[schema] upgraded CREATE .. IF NOT EXISTS (files changed): {upgraded_count}")

    if warnings:
        print("[schema] warnings:")
        for w in warnings:
            print(f"  - {w}")

    print("[schema] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
